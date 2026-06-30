import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'all_migrations.sql');
    const file = fs.readFileSync(filePath, 'utf-8');
    return new NextResponse(file, { 
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain'
      } 
    });
  } catch (err) {
    return new NextResponse(String(err), { status: 500 });
  }
}
