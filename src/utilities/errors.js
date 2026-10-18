'use strict';
class AppError extends Error { constructor(code,message,status=400,details){super(message);this.code=code;this.status=status;this.details=details;} }
const errors={auth:(m='Sign in is required.')=>new AppError('AUTH_REQUIRED',m,401),forbidden:(m='You do not have permission for this action.')=>new AppError('FORBIDDEN',m,403),validation:(m='Check the information and try again.',d)=>new AppError('VALIDATION_ERROR',m,400,d),notFound:(m='The requested record was not found.')=>new AppError('NOT_FOUND',m,404),conflict:(m='The record changed. Refresh and review your changes.',d)=>new AppError('CONFLICT',m,409,d)};
module.exports={AppError,errors};
