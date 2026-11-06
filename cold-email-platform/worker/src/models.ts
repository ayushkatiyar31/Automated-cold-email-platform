import { Schema, model, Types } from 'mongoose';

const uploadSchema = new Schema({ userId: { type: Schema.Types.ObjectId, required: true }, campaignId: { type: Schema.Types.ObjectId, required: true }, originalName: String, gridFsId: { type: Schema.Types.ObjectId, required: true }, status: String, error: String }, { timestamps: true });
export const Upload = model('Upload', uploadSchema);

const recipientSchema = new Schema({ campaignId: { type: Schema.Types.ObjectId, required: true }, userId: { type: Schema.Types.ObjectId, required: true }, email: { type: String, required: true, lowercase: true, trim: true }, name: String, company: String, status: { type: String, default: 'pending' }, attempts: { type: Number, default: 0 }, error: String, errorCode: String, gmailMessageId: String, sentAt: Date, nextAttemptAt: Date, idempotencyKey: { type: String, required: true }, updatedAt: Date }, { timestamps: true });
recipientSchema.index({ campaignId: 1, email: 1 }, { unique: true });
recipientSchema.index({ campaignId: 1, idempotencyKey: 1 }, { unique: true });
export const Recipient = model('Recipient', recipientSchema);

const campaignSchema = new Schema({ userId: { type: Schema.Types.ObjectId, required: true }, name: String, subject: String, body: String, resumeLink: String, includeResumeLink: { type: Boolean, default: true }, optOutEnabled: Boolean, optOutLine: String, status: String, pauseReason: String, counts: Object }, { timestamps: true });
export const Campaign = model('Campaign', campaignSchema);

const userSchema = new Schema({ name: String, email: String, gmail: { email: String, accessToken: String, refreshToken: String, expiryDate: Number } }, { timestamps: true });
export const User = model('User', userSchema);

const logSchema = new Schema({ userId: Schema.Types.ObjectId, campaignId: Schema.Types.ObjectId, recipientId: Schema.Types.ObjectId, recipientEmail: String, providerMessageId: String, status: String, error: String, errorCode: String, idempotencyKey: String }, { timestamps: true });
logSchema.index({ campaignId: 1, idempotencyKey: 1 }, { unique: true });
export const EmailLog = model('EmailLog', logSchema);
