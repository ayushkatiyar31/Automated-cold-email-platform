import { Schema, model, Types, Document } from 'mongoose';
export interface ICampaign extends Document {
  userId: Types.ObjectId; name: string; subject: string; body: string; resumeLink?: string;
  includeResumeLink: boolean; optOutEnabled: boolean; optOutLine?: string;
  status: 'draft'|'pending'|'sending'|'sent'|'paused'|'cancelled'|'failed';
  pauseReason?: string; counts?: { total: number; pending: number; sending: number; sent: number; failed: number; skipped: number };
}
const campaignSchema = new Schema<ICampaign>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, name: { type: String, required: true, trim: true },
  subject: { type: String, required: true }, body: { type: String, required: true }, resumeLink: String,
  includeResumeLink: { type: Boolean, default: true }, optOutEnabled: { type: Boolean, default: false }, optOutLine: String,
  pauseReason: String, counts: { total: { type: Number, default: 0 }, pending: { type: Number, default: 0 }, sending: { type: Number, default: 0 }, sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 }, skipped: { type: Number, default: 0 }, _id: false },
  status: { type: String, enum: ['draft','pending','sending','sent','paused','cancelled','failed'], default: 'draft' }
}, { timestamps: true });
campaignSchema.index({ userId: 1, createdAt: -1 });
export const Campaign = model<ICampaign>('Campaign', campaignSchema);
