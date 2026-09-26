import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI as string;

if (!uri) {
  throw new Error('Please add MONGODB_URI to your environment variables');
}

const client = new MongoClient(uri);
let db: Db;

export async function getDb(): Promise<Db> {
  if (!db) {
    await client.connect();
    db = client.db('food-spoilage'); // change to your database name if different
  }
  return db;
}