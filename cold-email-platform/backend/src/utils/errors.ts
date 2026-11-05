export class AppError extends Error { constructor(public statusCode: number, message: string, public code = 'APP_ERROR') { super(message); } }
export const notFound = (message = 'Not found') => new AppError(404, message, 'NOT_FOUND');
export const forbidden = (message = 'Forbidden') => new AppError(403, message, 'FORBIDDEN');
