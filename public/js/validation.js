export const LIMITS={offlineFile:15*1024*1024,bulkFile:5*1024*1024};
export function required(value,label='This field'){return String(value??'').trim()?null:`${label} is required.`;}
export function email(value){return !value||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())?null:'Enter a valid email address.';}
export function number(value,{label='Value',min,max,required:must=false}={}){if(value===''||value==null)return must?`${label} is required.`:null;const n=Number(value);if(!Number.isFinite(n))return `${label} must be a number.`;if(min!=null&&n<min)return `${label} must be at least ${min}.`;if(max!=null&&n>max)return `${label} cannot exceed ${max}.`;return null;}
export function score(value,max){return number(value,{label:'Score',min:0,max,required:true});}
export function date(value,label='Date'){if(!value)return `${label} is required.`;return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00`))?null:`${label} is invalid.`;}
export function password(value){return String(value||'').length>=8?null:'Password must contain at least 8 characters.';}
export function offlinePin(value){return String(value||'').length>=6?null:'Offline PIN or passphrase must contain at least 6 characters.';}
export function file(file,{types=[],maxSize=LIMITS.bulkFile}={}){if(!file)return 'Choose a file.';if(types.length&&!types.includes(file.type)&&!types.some(x=>file.name.toLowerCase().endsWith(x)))return 'Choose a supported file type.';if(file.size>maxSize)return `The file must be smaller than ${Math.round(maxSize/1024/1024)} MB.`;return null;}
export function validate(values,rules){const errors={};for(const [key,checks]of Object.entries(rules)){for(const check of[].concat(checks)){const message=check(values[key],values);if(message){errors[key]=message;break;}}}return errors;}
export function firstError(errors){return Object.values(errors).find(Boolean)||'';}
