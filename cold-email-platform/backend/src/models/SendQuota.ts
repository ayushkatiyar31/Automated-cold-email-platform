import { Schema, model, Types, Document } from 'mongoose';

export interface ISendQuota extends Document {
  userId: Types.ObjectId;
  windowStartedAt: Date;
  sentCount: number;
}

const sendQuotaSchema = new Schema<ISendQuota>({
  userId: { type: Schema.Types.ObjectId, required: true, unique: true },
  windowStartedAt: { type: Date, required: true },
  sentCount: { type: Number, required: true, default: 0 }
}, { timestamps: true });

export const SendQuota = model<ISendQuota>('SendQuota', sendQuotaSchema);
