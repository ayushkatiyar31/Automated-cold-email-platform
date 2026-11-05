import { Schema, model, Types } from 'mongoose';

const uploadSchema = new Schema({ userId: { type: Schema.Types.ObjectId, required: true }, campaignId: { type: Schema.Types.ObjectId, required: true }, originalName: String, gridFsId: { type: Schema.Types.ObjectId, required: true }, status: String, error: String }, { timestamps: true });
export const Upload = model('Upload', uploadSchema);

const recipientSchema = new Schema({ campaignId: { type: Schema.Types.ObjectId, required: true }, userId: { type: Schema.Types.ObjectId, required: true }, email: { type: String, required: true, lowercase: true, trim: true }, name: String, company: String, status: { type: String, default: 'pending' }, attempts: { type: Number, default: 0 }, idempotencyKey: { type: String, required: true } }, { timestamps: true });
recipientSchema.index({ campaignId: 1, email: 1 }, { unique: true });
recipientSchema.index({ campaignId: 1, idempotencyKey: 1 }, { unique: true });
export const Recipient = model('Recipient', recipientSchema);
