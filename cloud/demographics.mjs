export const genders = ['female', 'male', 'other', 'unknown'];
export function genderStats(rows) {
  const total=rows.reduce((sum,row)=>sum+Number(row.count),0);
  const categories=genders.map(gender=>{
    const count=Number(rows.find(row=>row.gender===gender)?.count || 0);
    return {gender,count,percentage:total ? Math.round(count*1000/total)/10 : 0};
  });
  return {total,categories};
}
