'use strict';
const {pool,transaction}=require('../db/pool'),{errors}=require('../utilities/errors'),{audit}=require('./audit-service');

async function list(identity,data={}){
  const limit=Math.min(Math.max(Number(data.limit)||50,1),100),offset=Math.max(Number(data.offset)||0,0),params=[identity.schoolId],where=["h.school_id=$1","h.entity_type IN('HISTORICAL_ENROLMENT_REVIEW','ROLLOVER_ENROLMENT_REVIEW')"];
  if(data.status){params.push(String(data.status).toUpperCase());where.push(`h.review_status=$${params.length}`);}
  if(data.classification){params.push(String(data.classification));where.push(`h.details->>'classification'=$${params.length}`);}
  if(data.search){params.push(`%${String(data.search).trim()}%`);where.push(`concat_ws(' ',s.admission_number,s.first_name,s.middle_name,s.last_name,se.name,c.name,ca.name,h.details->>'reason') ILIKE $${params.length}`);}
  params.push(limit,offset);
  const rows=(await pool.query(`SELECT h.*,e.id enrolment_id,e.status enrolment_status,e.class_id,e.class_arm_id,st.admission_date,s.id student_id,s.admission_number,s.first_name,s.middle_name,s.last_name,se.id session_id,se.name session_name,c.name class_name,ca.name arm_name,count(*) OVER()::int total_count
    FROM historical_migration_conflicts h
    LEFT JOIN student_session_enrolments e ON e.school_id=h.school_id AND e.student_id::text=h.details->>'studentId' AND e.academic_session_id::text=h.details->>'academicSessionId'
    LEFT JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
    LEFT JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id
    LEFT JOIN academic_sessions se ON se.id=e.academic_session_id AND se.school_id=e.school_id
    LEFT JOIN classes c ON c.id=e.class_id AND c.school_id=e.school_id
    LEFT JOIN class_arms ca ON ca.id=e.class_arm_id AND ca.school_id=e.school_id
    WHERE ${where.join(' AND ')} ORDER BY h.review_status,h.detected_at,h.id LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows;
  return{rows,total:rows[0]?.total_count||0,limit,offset};
}

async function decide(identity,data,req){
  const decision=String(data.decision||'PENDING').toUpperCase(),reason=String(data.reason||'').trim();
  if(!['PENDING','CONFIRM','CORRECT_ADMISSION_DATE','CORRECT_PLACEMENT','ARCHIVE'].includes(decision))throw errors.validation('Select a supported review decision.');
  if(decision!=='PENDING'&&!reason)throw errors.validation('A reason is required for historical corrections.');
  return transaction(async client=>{
    const conflict=(await client.query("SELECT * FROM historical_migration_conflicts WHERE school_id=$1 AND id=$2 AND entity_type IN('HISTORICAL_ENROLMENT_REVIEW','ROLLOVER_ENROLMENT_REVIEW') FOR UPDATE",[identity.schoolId,data.conflictId])).rows[0];
    if(!conflict)throw errors.notFound('Historical review record not found.');
    const studentId=conflict.details.studentId,sessionId=conflict.details.academicSessionId,enrolment=(await client.query('SELECT * FROM student_session_enrolments WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 FOR UPDATE',[identity.schoolId,studentId,sessionId])).rows[0];
    if(!enrolment)throw errors.notFound('Historical enrolment not found.');
    const evidence=(await client.query(`SELECT
      (SELECT count(*) FROM scores sc JOIN assessments a ON a.id=sc.assessment_id WHERE sc.school_id=$1 AND sc.student_id=$2 AND a.academic_session_id=$3)::int scores,
      (SELECT count(*) FROM results r JOIN result_batches rb ON rb.id=r.batch_id WHERE r.school_id=$1 AND r.student_id=$2 AND rb.academic_session_id=$3)::int results,
      (SELECT count(*) FROM report_cards rc WHERE rc.school_id=$1 AND rc.student_id=$2 AND rc.academic_session_id=$3)::int reports,
      (SELECT count(*) FROM student_class_history h WHERE h.school_id=$1 AND h.student_id=$2 AND h.academic_session_id=$3)::int history`,[identity.schoolId,studentId,sessionId])).rows[0];
    const old={conflict,enrolment};let nextStatus='PENDING';
    if(decision==='CONFIRM')nextStatus='CONFIRMED';
    if(decision==='CORRECT_ADMISSION_DATE'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(data.admissionDate||'')))throw errors.validation('Enter a valid corrected admission date.');
      await client.query('UPDATE students SET admission_date=$1,updated_by=$2,updated_at=now() WHERE school_id=$3 AND id=$4',[data.admissionDate,identity.id,identity.schoolId,studentId]);nextStatus='CORRECTED';
    }
    if(decision==='CORRECT_PLACEMENT'){
      const valid=(await client.query('SELECT 1 FROM classes c LEFT JOIN class_arms ca ON ca.school_id=c.school_id AND ca.class_id=c.id AND ca.id=$3 WHERE c.school_id=$1 AND c.id=$2 AND ($3::uuid IS NULL OR ca.id IS NOT NULL)',[identity.schoolId,data.classId,data.classArmId||null])).rows[0];
      if(!valid)throw errors.validation('Select a class and arm belonging to this school.');
      await client.query('UPDATE student_session_enrolments SET class_id=$1,class_arm_id=$2,updated_by=$3,updated_at=now() WHERE id=$4',[data.classId,data.classArmId||null,identity.id,enrolment.id]);nextStatus='CORRECTED';
    }
    if(decision==='ARCHIVE'){
      if(Number(evidence.scores)+Number(evidence.results)+Number(evidence.reports)>0)throw errors.conflict('This enrolment has academic evidence and cannot be archived through historical review.');
      await client.query("UPDATE student_session_enrolments SET status='ARCHIVED',updated_by=$1,updated_at=now() WHERE id=$2",[identity.id,enrolment.id]);nextStatus='ARCHIVED';
    }
    const row=(await client.query('UPDATE historical_migration_conflicts SET review_status=$1,review_decision=$2,review_reason=$3,reviewed_by=$4,reviewed_at=CASE WHEN $1=\'PENDING\' THEN NULL ELSE now() END,resolved_at=CASE WHEN $1=\'PENDING\' THEN NULL ELSE now() END WHERE id=$5 RETURNING *',[nextStatus,decision,reason||null,identity.id,conflict.id])).rows[0];
    await audit({schoolId:identity.schoolId,userId:identity.id,action:'HISTORICAL_ENROLMENT_REVIEWED',entityType:'HistoricalMigrationConflict',entityId:conflict.id,oldValue:old,newValue:{review:row,evidence,requested:data},req,client});
    return{review:row,evidence};
  });
}
module.exports={list,decide};
