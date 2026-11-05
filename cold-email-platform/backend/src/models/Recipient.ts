import { Schema, model, Types, Document } from 'mongoose';
export interface IRecipient extends Document { campaignId: Types.ObjectId; userId: Types.ObjectId; email: string; name?: string; company?: string; status: 'pending'|'sending'|'sent'|'failed'|'skipped'; attempts: number; error?: string; sentAt?: Date; idempotencyKey: string; }
const recipientSchema = new Schema<IRecipient>({
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true }, name: String, company: String,
  status: { type: String, enum: ['pending','sending','sent','failed','skipped'], default: 'pending' }, attempts: { type: Number, default: 0 }, error: String, sentAt: Date, idempotencyKey: { type: String, required: true }
}, { timestamps: true });
recipientSchema.index({ campaignId: 1, email: 1 }, { unique: true });
recipientSchema.index({ campaignId: 1, idempotencyKey: 1 }, { unique: true });
export const Recipient = model<IRecipient>('Recipient', recipientSchema);
