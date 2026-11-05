import { Schema, model, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  name: string; email: string; passwordHash: string; resumeLink?: string;
  refreshTokenHash?: string; comparePassword(password: string): Promise<boolean>;
}
const userSchema = new Schema<IUser>({
  name: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false }, resumeLink: { type: String, trim: true }, refreshTokenHash: { type: String, select: false }
}, { timestamps: true });
userSchema.methods.comparePassword = function(password: string) { return bcrypt.compare(password, this.passwordHash); };
export const User = model<IUser>('User', userSchema);
