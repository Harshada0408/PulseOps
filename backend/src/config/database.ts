import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
prisma?: PrismaClient;
};

const createPrismaClient = () => {
return new PrismaClient({
log:
process.env.NODE_ENV === 'development'
? [
{
emit: 'event',
level: 'error',
},
{
emit: 'event',
level: 'warn',
},
]
: ['error'],
});
};

export const prisma =
globalForPrisma.prisma ??
createPrismaClient();

if (
process.env.NODE_ENV !==
'production'
) {
globalForPrisma.prisma =
prisma;
}

prisma.$on(
  'error' as never,
  (e: unknown) => {
    console.error(
      '[DATABASE ERROR]',
      e
    );
  }
);

prisma.$on(
  'warn' as never,
  (e: unknown) => {
    console.warn(
      '[DATABASE WARNING]',
      e
    );
  }
);

export async function verifyDatabaseConnection() {
try {
await prisma.$queryRaw`SELECT 1`;

console.log(
  '✅ Database connected'
);

return true;

} catch (error) {
console.error(
'❌ Database connection failed',
error
);

return false;

}
}

export async function disconnectDatabase() {
try {
await prisma.$disconnect();

console.log(
  '✅ Database disconnected'
);

} catch (error) {
console.error(
'Database disconnect error',
error
);
}
}

process.on(
'beforeExit',
async () => {
await disconnectDatabase();
}
);
