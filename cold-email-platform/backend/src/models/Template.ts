import { Schema, model, Types, Document } from 'mongoose';
export interface ITemplate extends Document { userId: Types.ObjectId; name: string; subject: string; body: string; resumeLink?: string; isDefault: boolean; }
const templateSchema = new Schema<ITemplate>({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, name: { type: String, required: true, trim: true }, subject: { type: String, required: true }, body: { type: String, required: true }, resumeLink: String, isDefault: { type: Boolean, default: false } }, { timestamps: true });
templateSchema.index({ userId: 1, name: 1 }, { unique: true });
export const Template = model<ITemplate>('Template', templateSchema);
