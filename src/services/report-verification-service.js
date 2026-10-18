'use strict';
const crypto=require('crypto'),fs=require('fs'),{pool}=require('../db/pool'),{hash,safeEqual}=require('../security/crypto'),storage=require('../reports/storage'),{logoFor}=require('../reports/pdf'),{ordinal}=require('../utilities/ordinal'),{reportClassSize}=require('./report-class-size-service');

async function resolve(token,{includePdf=false}={}){
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(String(token||'')))return null;
  const row=(await pool.query(`SELECT rc.id,rc.school_id,rc.academic_session_id,rc.term_id,rc.class_id,rc.class_arm_id,rc.status,rc.storage_key,rc.file_name,rc.mime_type,rc.checksum,rc.report_version,rc.published_at,rc.publication_snapshot
    FROM report_cards rc
    WHERE rc.verification_token_hash=$1 AND rc.status='PUBLISHED'
      AND NOT EXISTS(SELECT 1 FROM report_cards newer
        WHERE newer.school_id=rc.school_id AND newer.student_id=rc.student_id
          AND newer.academic_session_id=rc.academic_session_id AND newer.term_id=rc.term_id
          AND newer.status='PUBLISHED'
          AND (newer.report_version,newer.published_at,newer.id)>(rc.report_version,rc.published_at,rc.id))
    LIMIT 1`,[hash(token)])).rows[0];
  if(!row||!row.publication_snapshot)return null;
  const buffer=await storage.get(row.storage_key),actual=crypto.createHash('sha256').update(buffer).digest('hex');
  if(!safeEqual(actual,row.checksum))return{integrity:false};
  const report={...row.publication_snapshot,publication:{...(row.publication_snapshot.publication||{}),version:row.report_version,publishedAt:row.published_at}};
  report.summary||={};
  report.summary.classSize||=await reportClassSize(pool,row);
  let logoData=report.logoData||null;
  const logo=!logoData&&logoFor(report.school||{});
  if(logo&&fs.existsSync(logo)){
    const ext=logo.toLowerCase().endsWith('.svg')?'svg+xml':'png';
    logoData=`data:image/${ext};base64,${fs.readFileSync(logo).toString('base64')}`;
  }
  return{integrity:true,report,logoData,fileName:row.file_name,mimeType:row.mime_type,buffer:includePdf?buffer:null,ordinal};
}
module.exports={resolve};
