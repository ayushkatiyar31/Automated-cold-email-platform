import { Schema, model, Types, Document } from 'mongoose';
export interface IUpload extends Document {
  userId: Types.ObjectId;
  campaignId?: Types.ObjectId;
  originalName: string;
  mimeType: string;
  size: number;
  gridFsId: Types.ObjectId;
  status: 'queued'|'uploaded'|'processing'|'processed'|'failed';
  error?: string;
  queuedAt?: Date;
  statusChangedAt?: Date;
  rowsScanned: number;
  recipientsFound: number;
  recipientsInserted: number;
}
const uploadSchema = new Schema<IUpload>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
  originalName: { type: String, required: true },
  mimeType: String,
  size: { type: Number, required: true },
  gridFsId: { type: Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ['queued','uploaded','processing','processed','failed'], default: 'queued', index: true },
  error: String,
  queuedAt: Date,
  statusChangedAt: Date,
  rowsScanned: { type: Number, default: 0 },
  recipientsFound: { type: Number, default: 0 },
  recipientsInserted: { type: Number, default: 0 }
}, { timestamps: true });
export const Upload = model<IUpload>('Upload', uploadSchema);
