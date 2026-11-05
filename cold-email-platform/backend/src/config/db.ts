import mongoose from 'mongoose';
import { env } from './env';
export async function connectDatabase() { await mongoose.connect(env.mongodbUri); }
export async function disconnectDatabase() { await mongoose.disconnect(); }
