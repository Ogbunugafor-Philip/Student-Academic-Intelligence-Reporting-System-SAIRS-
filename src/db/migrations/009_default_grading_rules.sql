INSERT INTO grading_rules(school_id,grade,minimum_score,maximum_score,remark,sort_order,status)
SELECT s.id,v.grade,v.minimum_score,v.maximum_score,v.remark,v.sort_order,'ACTIVE'
FROM schools s
CROSS JOIN (VALUES
  ('A',70,100,'Excellent',1),
  ('B',60,69,'Very Good',2),
  ('C',50,59,'Good',3),
  ('D',45,49,'Pass',4),
  ('E',40,44,'Fair',5),
  ('F',0,39,'Needs Improvement',6)
) AS v(grade,minimum_score,maximum_score,remark,sort_order)
WHERE NOT EXISTS(SELECT 1 FROM grading_rules g WHERE g.school_id=s.id)
ON CONFLICT(school_id,grade) DO NOTHING;
