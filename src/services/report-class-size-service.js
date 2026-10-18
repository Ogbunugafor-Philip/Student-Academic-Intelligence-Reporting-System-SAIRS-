"use strict";
async function reportClassSize(client, scope) {
  if (!scope) return 0;
  const schoolId = scope.school_id || scope.schoolId || scope.school?.id,
    sessionId =
      scope.academic_session_id || scope.sessionId || scope.session?.id,
    termId = scope.term_id || scope.termId || scope.term?.id,
    classId = scope.class_id || scope.classId || scope.classRow?.id,
    classArmId =
      scope.class_arm_id ?? scope.classArmId ?? scope.arm?.id ?? null;
  if (!schoolId || !sessionId || !termId || !classId) return 0;
  const row = (
    await client.query(
      "SELECT count(DISTINCT r.student_id)::int class_size FROM results r JOIN result_batches rb ON rb.id=r.batch_id WHERE rb.school_id=$1 AND rb.academic_session_id=$2 AND rb.term_id=$3 AND rb.class_id=$4 AND rb.class_arm_id IS NOT DISTINCT FROM $5",
      [schoolId, sessionId, termId, classId, classArmId],
    )
  ).rows[0];
  return Number(row?.class_size || 0);
}
module.exports = { reportClassSize };
