import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Simple console logger
const log = {
  info: (msg, data) => console.log(`ℹ️ ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`⚠️ ${msg}`, data || ''),
  error: (msg, data) => console.error(`❌ ${msg}`, data || ''),
  success: (msg, data) => console.log(`✅ ${msg}`, data || '')
};

async function main() {
  log.info('🌱 Starting admin user seed...');

  const adminEmail = process.env.ADMIN_EMAIL || 'alagar17302@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'SuperAdmin@123';

  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    log.warn('Using default admin credentials');
  }

  try {
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail }
    });

    if (existingAdmin) {
      log.info('Admin user already exists');
      log.info(`Email: ${adminEmail}`);
      return;
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        name: 'Super Admin',
        role: 'ADMIN',
        emailVerified: new Date(),
        isActive: true
      }
    });
    
    log.success('Admin user created successfully!');
    log.info(`User ID: ${adminUser.id}`);
    log.info(`Email: ${adminEmail}`);
    log.info(`Name: ${adminUser.name}`);

    if (adminPassword === 'SuperAdmin@123') {
      log.warn('SECURITY: Change default password after login');
    }

  } catch (error) {
    log.error('Failed to create admin user:', error.message);
    throw error;
  }
}

main()
  .then(() => {
    log.success('Admin seed completed successfully!');
  })
  .catch((error) => {
    log.error('Admin seed process failed:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });