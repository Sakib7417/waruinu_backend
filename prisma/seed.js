const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@waruinu.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        role: 'ADMIN',
        isVerified: true,
      },
    });

    console.log(`Admin user created with email: ${adminEmail}`);
  } else {
    console.log('Admin user already exists.');
  }

  // Create default membership packages if not exists
  const packages = [
    { name: 'Gender Prediction', price: 1499, ticketLimit: 3, durationMonths: null },
    { name: '1 Year Membership', price: 4999, ticketLimit: null, durationMonths: 12 },
  ];

  for (const pkg of packages) {
    const existing = await prisma.membershipPackage.findFirst({
      where: { name: pkg.name },
    });
    if (!existing) {
      await prisma.membershipPackage.create({ data: pkg });
      console.log(`Created package: ${pkg.name}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
