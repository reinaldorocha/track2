const fs = require('fs');
const path = require('path');
const { loadEnvConfig } = require('@next/env');

loadEnvConfig(path.join(__dirname, '..'));

const target = process.argv[2] || 'detect'; // 'postgres', 'sqlite', or 'detect'
const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const schemaContent = fs.readFileSync(schemaPath, 'utf8');

let newProvider = 'postgresql';

if (target === 'postgres' || target === 'postgresql') {
  newProvider = 'postgresql';
} else if (target === 'sqlite') {
  newProvider = 'sqlite';
} else {
  // Detect from DATABASE_URL or environment
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.startsWith('file:') || target === 'dev') {
    newProvider = 'sqlite';
  } else {
    newProvider = 'postgresql';
  }
}

const dbUrl = process.env.DATABASE_URL || '';
if (process.env.VERCEL && newProvider !== 'postgresql') {
  throw new Error('Deploy Vercel exige DATABASE_URL PostgreSQL.');
}
if (dbUrl && newProvider === 'postgresql' && !/^postgres(ql)?:\/\//.test(dbUrl)) {
  throw new Error('DATABASE_URL deve apontar para PostgreSQL quando o provider é postgresql.');
}
if (dbUrl && newProvider === 'sqlite' && !dbUrl.startsWith('file:')) {
  throw new Error('DATABASE_URL deve usar file: quando o provider é sqlite.');
}

const updatedContent = schemaContent.replace(
  /datasource db \{\s*provider\s*=\s*"[^"]*"/,
  `datasource db {\n  provider = "${newProvider}"`
);

if (updatedContent !== schemaContent) fs.writeFileSync(schemaPath, updatedContent);
console.log(`[Prisma Database Provider] Schema configured for: ${newProvider}`);
