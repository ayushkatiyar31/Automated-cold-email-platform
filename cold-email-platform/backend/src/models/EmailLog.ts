import { Schema, model, Types, Document } from 'mongoose';
export interface IEmailLog extends Document { userId: Types.ObjectId; campaignId: Types.ObjectId; recipientId: Types.ObjectId; recipientEmail: string; providerMessageId?: string; status: 'sent'|'failed'; error?: string; idempotencyKey: string; }
const emailLogSchema = new Schema<IEmailLog>({ userId: { type: Schema.Types.ObjectId, required: true, index: true }, campaignId: { type: Schema.Types.ObjectId, required: true, index: true }, recipientId: { type: Schema.Types.ObjectId, required: true }, recipientEmail: String, providerMessageId: String, status: { type: String, enum: ['sent','failed'], required: true }, error: String, idempotencyKey: { type: String, required: true } }, { timestamps: true });
emailLogSchema.index({ campaignId: 1, idempotencyKey: 1 }, { unique: true });
export const EmailLog = model<IEmailLog>('EmailLog', emailLogSchema);
