'use strict';
function ordinal(value){const number=Number(value);if(!Number.isInteger(number)||number<1)return'—';const mod100=number%100,suffix=mod100>=11&&mod100<=13?'th':number%10===1?'st':number%10===2?'nd':number%10===3?'rd':'th';return`${number}${suffix}`;}
module.exports={ordinal};

