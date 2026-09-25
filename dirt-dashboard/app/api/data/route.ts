import { NextRequest, NextResponse } from 'next/server';

interface SensorReading {
  metric: string;
  value: number;
  unit: string;
}

interface SensorPayload {
  samples: {
    ts: number;
    sensordata: SensorReading[];
  }[];
}

export async function POST(request: NextRequest) {
  const body: SensorPayload = await request.json();
  let mongostatus: boolean;
  // insert into MongoDB here


  mongostatus = false;
  return NextResponse.json({ message: 'Data received', mongostatus });
}



export async function GET(request: NextRequest) {
  // fetch from MongoDB here

  return NextResponse.json({ data: [] });
}