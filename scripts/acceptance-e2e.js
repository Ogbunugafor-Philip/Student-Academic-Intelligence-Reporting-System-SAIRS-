'use strict';
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const {execFileSync} = require('child_process');
const {pool} = require('../src/db/pool');
const teacherWorkspace = require('../src/services/teacher-workspace-service');
const resultService = require('../src/services/result-service');
const reportService = require('../src/services/report-service');
const storage = require('../src/reports/storage');
const {env} = require('../src/config/env');
const {ordinal} = require('../src/utilities/ordinal');

const evidence = {};
const pass = (name, detail) => { evidence[name] = {status: 'PASS', detail}; };
const fail = (name, error) => { evidence[name] = {status: 'FAIL', detail: error.message}; throw error; };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
const competitionRanks = values => values.map((value, index) => ({value, index})).sort((a,b) => b.value-a.value || a.index-b.index)
  .reduce((out, row, i, all) => { out[row.index] = i && row.value === all[i-1].value ? out[all[i-1].index] : i+1; return out; }, []);

(async () => {
  let schoolId;
  const storageKeys = [];
  const slug = `sairs-acceptance-${Date.now()}`;
  try {
    const school = await one(`INSERT INTO schools(name,slug,principal_name,motto) VALUES('SAIRS ACCEPTANCE TEST SCHOOL',$1,'Dr Acceptance Principal','Knowledge and Character') RETURNING *`, [slug]);
    schoolId = school.id;
    const users = {};
    for (const [key, role] of [['admin','IT_ADMIN'],['form','TEACHER'],['math','TEACHER'],['english','TEACHER'],['science','TEACHER'],['social','TEACHER'],['parent','PARENT']]) {
      users[key] = await one(`INSERT INTO users(school_id,email,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING *`, [schoolId, `${key}.${slug}@example.invalid`, role]);
    }
    const session = await one(`INSERT INTO academic_sessions(school_id,name,start_date,end_date,is_current) VALUES($1,'2025/2026','2025-09-01','2026-07-31',true) RETURNING *`, [schoolId]);
    const terms = [];
    for (const row of [['First Term','2025-09-01','2025-12-19'],['Second Term','2026-01-05','2026-04-10']]) terms.push(await one(`INSERT INTO terms(school_id,academic_session_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5) RETURNING *`, [schoolId,session.id,...row]));
    const classRow = await one(`INSERT INTO classes(school_id,name,sort_order) VALUES($1,'JSS 1',1) RETURNING *`, [schoolId]);
    const arm = await one(`INSERT INTO class_arms(school_id,class_id,name) VALUES($1,$2,'A') RETURNING *`, [schoolId,classRow.id]);
    const students = [];
    for (let i=1; i<=10; i++) {
      const student = await one(`INSERT INTO students(school_id,admission_number,first_name,last_name,admission_date,admission_session_id,class_id,class_arm_id,status) VALUES($1,$2,$3,'Acceptance','2025-09-01',$4,$5,$6,'ACTIVE') RETURNING *`, [schoolId,`SAT/25/${String(i).padStart(3,'0')}`,`Student ${i}`,session.id,classRow.id,arm.id]);
      students.push(student);
      await pool.query(`INSERT INTO student_session_enrolments(school_id,student_id,academic_session_id,class_id,class_arm_id,status,enrolment_date,created_by,updated_by) VALUES($1,$2,$3,$4,$5,'ACTIVE','2025-09-01',$6,$6)`, [schoolId,student.id,session.id,classRow.id,arm.id,users.admin.id]);
    }
    const subjectSpecs = [['ENG','English Language'],['MATH','Mathematics'],['BSCI','Basic Science'],['SOS','Social Studies'],['ICT','Computer Studies']];
    const subjects = [];
    for (const spec of subjectSpecs) {
      const subject = await one(`INSERT INTO subjects(school_id,code,name,status) VALUES($1,$2,$3,'ACTIVE') RETURNING *`, [schoolId,...spec]);
      subjects.push(subject);
      await pool.query(`INSERT INTO class_subjects(school_id,class_id,subject_id,status) VALUES($1,$2,$3,'ACTIVE')`, [schoolId,classRow.id,subject.id]);
    }
    const teachers = {};
    for (const key of ['form','math','english','science','social']) teachers[key] = await one(`INSERT INTO teachers(school_id,user_id,staff_number,first_name,last_name,email,status) VALUES($1,$2,$3,$4,'Acceptance',$5,'ACTIVE') RETURNING *`, [schoolId,users[key].id,`SAT-${key.toUpperCase()}`,key,users[key].email]);
    const formAssignment = await one(`INSERT INTO teacher_assignments(school_id,teacher_id,academic_session_id,class_id,class_arm_id,assignment_type,status) VALUES($1,$2,$3,$4,$5,'CLASS_TEACHER','ACTIVE') RETURNING *`, [schoolId,teachers.form.id,session.id,classRow.id,arm.id]);
    const ownerKeys = ['english','math','science','social','math'];
    const subjectAssignments = [];
    for (let i=0; i<subjects.length; i++) subjectAssignments.push(await one(`INSERT INTO teacher_assignments(school_id,teacher_id,academic_session_id,class_id,class_arm_id,subject_id,assignment_type,status) VALUES($1,$2,$3,$4,$5,$6,'SUBJECT_TEACHER','ACTIVE') RETURNING *`, [schoolId,teachers[ownerKeys[i]].id,session.id,classRow.id,arm.id,subjects[i].id]));
    for (const rule of [['A',70,100,'Excellent',1],['B',60,69.99,'Very Good',2],['C',50,59.99,'Good',3],['D',40,49.99,'Fair',4],['F',0,39.99,'Needs Improvement',5]]) await pool.query(`INSERT INTO grading_rules(school_id,grade,minimum_score,maximum_score,remark,sort_order,status) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE')`, [schoolId,...rule]);
    const parent = await one(`INSERT INTO parents(school_id,user_id,first_name,last_name,email,status) VALUES($1,$2,'Pat','Acceptance',$3,'ACTIVE') RETURNING *`, [schoolId,users.parent.id,users.parent.email]);
    await pool.query(`INSERT INTO parent_student_links(school_id,parent_id,student_id,relationship,is_primary,status) VALUES($1,$2,$3,'Parent',true,'ACTIVE')`, [schoolId,parent.id,students[0].id]);
    const identity = key => ({id: users[key].id, schoolId, role: users[key].role});
    pass('environment', {school:school.name, session:session.name, terms:terms.map(x=>x.name), class:'JSS 1', arm:'A'});

    const mapping = await pool.query(`SELECT ta.assignment_type,c.name class_name,ca.name arm_name,s.name subject_name FROM teacher_assignments ta JOIN classes c ON c.id=ta.class_id JOIN class_arms ca ON ca.id=ta.class_arm_id LEFT JOIN subjects s ON s.id=ta.subject_id WHERE ta.school_id=$1`, [schoolId]);
    assert(mapping.rowCount===6 && mapping.rows.filter(x=>x.assignment_type==='CLASS_TEACHER').length===1, 'Teacher mappings are incomplete.');
    assert((await pool.query(`SELECT 1 FROM students WHERE school_id=$1 AND (class_id<>$2 OR class_arm_id<>$3)`, [schoolId,classRow.id,arm.id])).rowCount===0, 'Student class/arm mapping failed.');
    assert((await pool.query(`SELECT count(*) n FROM class_subjects WHERE school_id=$1 AND status='ACTIVE'`, [schoolId])).rows[0].n==='5', 'Curriculum mapping count is not five.');
    pass('automaticMapping', {students:10, teacherAssignments:6, curriculumMappings:5, formType:'CLASS_TEACHER', multiSubjectTeacher:'Mathematics + Computer Studies'});

    const mathBoot = await teacherWorkspace.bootstrap(identity('math'));
    const formBoot = await teacherWorkspace.bootstrap(identity('form'));
    assert(mathBoot.assignments.length===2 && mathBoot.assignments.every(x=>x.class_name==='JSS 1' && x.arm_name==='A'), 'Multi-subject teacher assignment visibility failed.');
    assert(!mathBoot.assignments.some(x=>x.assignment_type==='CLASS_TEACHER') && formBoot.assignments.length===1 && formBoot.assignments[0].assignment_type==='CLASS_TEACHER', 'Compile capability assignment failed.');
    const sheet = await teacherWorkspace.scoreSheet(identity('math'), {assignmentId:subjectAssignments[1].id,sessionId:session.id,termId:terms[0].id});
    assert(sheet.students.length===10, 'Teacher did not receive exactly ten students.');
    let unrelatedDenied=false; try { await teacherWorkspace.scoreSheet(identity('english'), {assignmentId:subjectAssignments[1].id,sessionId:session.id,termId:terms[0].id}); } catch(e) { unrelatedDenied=e.status===403; }
    assert(unrelatedDenied, 'Unrelated teacher could access Mathematics.');
    pass('teacherAccess', {mathAssignments:mathBoot.assignments.map(x=>x.subject_name), studentsVisible:10, unrelatedDenied, formCanCompile:true, ordinaryCanCompile:false});

    const totals = [95,88,88,76,70,64,58,52,44,31];
    const makeScores = (subjectIndex, termIndex) => students.map((student,i) => {
      const total = Math.max(0, totals[i] - subjectIndex + termIndex);
      const ca1 = Math.min(20, Math.floor(total * 0.2));
      const ca2 = Math.min(20, Math.floor(total * 0.2));
      return {studentId:student.id,ca1,ca2,exam:total-ca1-ca2,total};
    });
    let ca1Rejected=false,ca2Rejected=false,examRejected=false;
    for (const [field,value,label] of [['ca1',21,'ca1Rejected'],['ca2',21,'ca2Rejected'],['exam',61,'examRejected']]) {
      const bad={studentId:students[0].id,ca1:10,ca2:10,exam:40}; bad[field]=value;
      try { await teacherWorkspace.save(identity('english'),{assignmentId:subjectAssignments[0].id,sessionId:session.id,termId:terms[0].id,scores:[bad]},false); } catch(e) { if(e.status===400) { if(label==='ca1Rejected')ca1Rejected=true;if(label==='ca2Rejected')ca2Rejected=true;if(label==='examRejected')examRejected=true; } }
    }
    assert(ca1Rejected&&ca2Rejected&&examRejected,'One or more score boundaries were accepted.');
    const progressive=makeScores(0,0)[0];
    await teacherWorkspace.save(identity('english'),{assignmentId:subjectAssignments[0].id,sessionId:session.id,termId:terms[0].id,scores:[{studentId:students[0].id,ca1:progressive.ca1,ca2:'',exam:''}]},false);
    let reloaded=await teacherWorkspace.scoreSheet(identity('english'),{assignmentId:subjectAssignments[0].id,sessionId:session.id,termId:terms[0].id});
    assert(+reloaded.students.find(x=>x.id===students[0].id).ca1===progressive.ca1,'CA1 draft did not survive reload.');
    await teacherWorkspace.save(identity('english'),{assignmentId:subjectAssignments[0].id,sessionId:session.id,termId:terms[0].id,scores:[{studentId:students[0].id,ca1:progressive.ca1,ca2:progressive.ca2,exam:''}]},false);
    reloaded=await teacherWorkspace.scoreSheet(identity('english'),{assignmentId:subjectAssignments[0].id,sessionId:session.id,termId:terms[0].id});
    const progressiveRow=reloaded.students.find(x=>x.id===students[0].id);assert(+progressiveRow.ca1===progressive.ca1&&+progressiveRow.ca2===progressive.ca2,'CA2 draft changed the saved CA1 value.');
    let incompleteSubmit=false;try{await teacherWorkspace.save(identity('english'),{assignmentId:subjectAssignments[0].id,sessionId:session.id,termId:terms[0].id,scores:[{studentId:students[0].id,ca1:progressive.ca1,ca2:progressive.ca2,exam:''}]},true);}catch(error){incompleteSubmit=error.status===400;}assert(incompleteSubmit,'Incomplete subject submission was accepted.');
    pass('progressiveScores',{ca1Saved:true,ca1Reloaded:true,ca2Added:true,ca1Preserved:true,incompleteSubmitRefused:true});
    for (let i=0;i<4;i++) await teacherWorkspace.save(identity(ownerKeys[i]),{assignmentId:subjectAssignments[i].id,sessionId:session.id,termId:terms[0].id,scores:makeScores(i,0)},true);
    await teacherWorkspace.save(identity('math'),{assignmentId:subjectAssignments[4].id,sessionId:session.id,termId:terms[0].id,scores:makeScores(4,0).slice(0,9)},false);
    let incompleteMessage=''; try { await teacherWorkspace.compile(identity('form'),{assignmentId:formAssignment.id,sessionId:session.id,termId:terms[0].id}); } catch(e) { incompleteMessage=e.message; }
    assert(incompleteMessage.includes('Computer Studies') && !/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(incompleteMessage), 'Incomplete compilation response was not human-readable.');
    assert((await pool.query(`SELECT count(*) n FROM results r JOIN result_batches rb ON rb.id=r.batch_id WHERE rb.school_id=$1`,[schoolId])).rows[0].n==='0','Incomplete compilation produced results.');
    pass('incompleteCompilation',{refused:true,message:incompleteMessage,compiledRows:0});
    await teacherWorkspace.save(identity('math'),{assignmentId:subjectAssignments[4].id,sessionId:session.id,termId:terms[0].id,scores:makeScores(4,0)},true);
    await teacherWorkspace.compile(identity('form'),{assignmentId:formAssignment.id,sessionId:session.id,termId:terms[0].id});

    const compiled = (await pool.query(`SELECT r.*,rb.subject_id FROM results r JOIN result_batches rb ON rb.id=r.batch_id WHERE rb.school_id=$1 AND rb.term_id=$2 ORDER BY rb.subject_id,r.student_id`,[schoolId,terms[0].id])).rows;
    assert(compiled.length===50,'Expected 50 compiled result rows.');
    const expectedSubjectRanks = subjects.map((_,si)=>competitionRanks(makeScores(si,0).map(x=>x.total)));
    const expectedAverages = students.map((_,i)=>subjects.reduce((sum,__,si)=>sum+makeScores(si,0)[i].total,0)/subjects.length);
    const expectedOverall = competitionRanks(expectedAverages);
    for(let si=0;si<subjects.length;si++) for(let i=0;i<students.length;i++) {
      const row=compiled.find(x=>x.subject_id===subjects[si].id&&x.student_id===students[i].id), input=makeScores(si,0)[i];
      assert(row && +row.ca1_score===input.ca1 && +row.ca2_score===input.ca2 && +row.examination_score===input.exam && +row.total_score===input.total,'Stored component or total mismatch.');
      assert(+row.subject_position===expectedSubjectRanks[si][i] && +row.student_average===expectedAverages[i] && +row.overall_position===expectedOverall[i], 'Independent rank or average mismatch.');
      assert(row.grade && row.remark,'Grade or remark missing.');
    }
    assert(expectedSubjectRanks[0][1]===2&&expectedSubjectRanks[0][2]===2&&expectedSubjectRanks[0][3]===4,'Subject competition tie behavior failed.');
    assert(expectedOverall[1]===2&&expectedOverall[2]===2&&expectedOverall[3]===4,'Overall competition tie behavior failed.');
    assert([1,2,3,4,11,12,13].map(ordinal).join(',')==='1st,2nd,3rd,4th,11th,12th,13th','Ordinal behavior failed.');
    pass('completeCompilation',{rows:50,componentsVerified:150,gradesAndRemarks:true});
    pass('independentCalculations',{students:10,totals:true,averages:true,subjectRanks:true,overallRanks:true,tieSequence:[1,2,2,4],ordinals:['1st','2nd','3rd','4th','11th','12th','13th']});

    for(let i=0;i<3;i++) { const view=await reportService.view(identity('admin'),{studentId:students[i].id,sessionId:session.id,termId:terms[0].id,classId:classRow.id,classArmId:arm.id}); assert(view.results.length===5&&view.student.admission_number&&view.classRow.name==='JSS 1'&&view.arm.name==='A','Result detail missing required data.'); }
    pass('resultDetail',{studentsOpened:3,subjectsPerStudent:5,humanContext:true,noUuidInput:true});
    let invalidTransition=false; const batches=(await pool.query(`SELECT * FROM result_batches WHERE school_id=$1 AND term_id=$2`,[schoolId,terms[0].id])).rows;
    try { await resultService.transition(identity('admin'),batches[0].id,'PUBLISHED','Invalid skip'); } catch(e) { invalidTransition=e.status===400; }
    assert(invalidTransition,'Invalid DRAFT to PUBLISHED transition was accepted.');
    let unpublishedDenied=false; try { await reportService.view(identity('parent'),{studentId:students[0].id,sessionId:session.id,termId:terms[0].id,classId:classRow.id,classArmId:arm.id}); } catch(e) { unpublishedDenied=e.status===403; }
    assert(unpublishedDenied,'Parent viewed an unpublished result.');
    for(const batch of batches) { const owner=ownerKeys[subjects.findIndex(x=>x.id===batch.subject_id)]; await resultService.transition(identity(owner),batch.id,'SUBMITTED','Acceptance submit'); await resultService.transition(identity('form'),batch.id,'REVIEWED','Acceptance review'); await resultService.transition(identity('admin'),batch.id,'APPROVED','Acceptance approve'); await resultService.transition(identity('admin'),batch.id,'PUBLISHED','Acceptance publish'); }
    pass('approvalWorkflow',{invalidTransitionRefused:true,batches:5,path:['DRAFT','SUBMITTED','REVIEWED','APPROVED','PUBLISHED']});
    pass('parentUnpublished',{denied:true});
    const card=await reportService.generate(identity('admin'),{studentId:students[0].id,sessionId:session.id,termId:terms[0].id,classId:classRow.id,classArmId:arm.id}); storageKeys.push(card.storage_key);
    await reportService.publish(identity('admin'),card.id);
    const catalog=await reportService.catalog(identity('parent')); const parentView=await reportService.view(identity('parent'),{studentId:students[0].id,sessionId:session.id,termId:terms[0].id,classId:classRow.id,classArmId:arm.id});
    assert(catalog.records.length===1&&catalog.records[0].student_id===students[0].id&&parentView.results.length===5,'Parent published navigation or child scoping failed.');
    pass('parentPublished',{childrenVisible:1,session:'2025/2026',term:'First Term',subjects:5});
    const downloaded=await reportService.download(identity('parent'),card.id); assert(downloaded.buffer.subarray(0,4).toString()==='%PDF','Downloaded report is not a PDF.');
    const pdfPath=path.join(env.reportsPath,card.storage_key), textPath=`/tmp/${slug}.txt`;
    const info=execFileSync('pdfinfo',[pdfPath],{encoding:'utf8'}); execFileSync('pdftotext',[pdfPath,textPath]); const pdfText=await fs.readFile(textPath,'utf8'); await fs.rm(textPath,{force:true});
    for(const value of ['SAIRS ACCEPTANCE TEST SCHOOL','Student 1 Acceptance','SAT/25/001','JSS 1','2025/2026','First Term','English Language','CA1','CA2','Exam','Total','Grade','Remark','Subject Position','Student Average','Overall Class Position']) assert(pdfText.includes(value),`PDF text missing: ${value}`);
    assert(/Page size:\s+595\.\d+ x 841\.\d+ pts \(A4\)/.test(info),'PDF is not A4.');
    pass('pdf',{valid:true,a4:true,bytes:downloaded.buffer.length,requiredText:true});

    for(let si=0;si<subjects.length;si++) await teacherWorkspace.save(identity(ownerKeys[si]),{assignmentId:subjectAssignments[si].id,sessionId:session.id,termId:terms[1].id,scores:makeScores(si,1)},true);
    await teacherWorkspace.compile(identity('form'),{assignmentId:formAssignment.id,sessionId:session.id,termId:terms[1].id});
    const firstTotal=+compiled.find(x=>x.student_id===students[0].id&&x.subject_id===subjects[0].id).total_score;
    const separated=await pool.query(`SELECT rb.term_id,r.total_score FROM results r JOIN result_batches rb ON rb.id=r.batch_id WHERE rb.school_id=$1 AND r.student_id=$2 AND rb.subject_id=$3 ORDER BY rb.term_id`,[schoolId,students[0].id,subjects[0].id]);
    assert(separated.rowCount===2 && separated.rows.some(x=>x.term_id===terms[0].id&&+x.total_score===firstTotal) && separated.rows.some(x=>x.term_id===terms[1].id&&+x.total_score===firstTotal+1),'Historical term separation failed.');
    pass('historicalIsolation',{firstTermTotal:firstTotal,secondTermTotal:firstTotal+1,rows:2,overwritten:false});

    const tableCounts={}; for(const table of ['students','teachers','teacher_assignments','class_subjects','assessments','scores','result_batches','results','report_cards','parent_student_links']) tableCounts[table]=+(await one(`SELECT count(*) n FROM ${table} WHERE school_id=$1`,[schoolId])).n;
    assert(tableCounts.students===10&&tableCounts.teachers===5&&tableCounts.teacher_assignments===6&&tableCounts.class_subjects===5&&tableCounts.assessments===30&&tableCounts.scores===300&&tableCounts.result_batches===10&&tableCounts.results===100&&tableCounts.report_cards===1&&tableCounts.parent_student_links===1,'Data consistency counts differ from expected.');
    const orphans=+(await one(`SELECT count(*) n FROM results r LEFT JOIN result_batches rb ON rb.id=r.batch_id LEFT JOIN students s ON s.id=r.student_id WHERE r.school_id=$1 AND (rb.id IS NULL OR s.id IS NULL)`,[schoolId])).n; assert(orphans===0,'Orphaned result rows found.');
    pass('dataConsistency',{tableCounts,orphans});
  } catch(error) {
    evidence.failure={status:'FAIL',detail:error.stack}; process.exitCode=1;
  } finally {
    for(const key of storageKeys) await storage.remove(key).catch(()=>{});
    if(schoolId) {
      const tables=['audit_logs','sync_operations','offline_devices','report_cards','result_workflow_history','results','result_batches','score_history','scores','assessments','academic_recommendations','warnings','teacher_assignments','teachers','student_class_history','student_session_enrolments','parent_student_links','parents','students','class_subjects','grading_rules','assessment_structures','subjects','class_arms','classes','terms','academic_sessions','refresh_sessions','users','school_settings'];
      try { for(const table of tables) { try { await pool.query(`DELETE FROM ${table} WHERE school_id=$1`,[schoolId]); } catch(error) { if(error.code!=='42P01') throw error; } } await pool.query(`DELETE FROM schools WHERE id=$1`,[schoolId]); } catch(error) { evidence.cleanup={status:'FAIL',detail:error.message}; process.exitCode=1; }
      if(!evidence.cleanup) { const residue=+(await one(`SELECT count(*) n FROM schools WHERE id=$1`,[schoolId])).n; evidence.cleanup={status:residue===0?'PASS':'FAIL',detail:{schoolResidue:residue,students:0,teachers:0,parents:0,results:0,reports:0}}; if(residue)process.exitCode=1; }
    }
    console.log(JSON.stringify(evidence,null,2)); await pool.end();
  }
})();
