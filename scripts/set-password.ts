import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

const email = process.argv[2]?.toLowerCase().trim();
const password = process.env.NEW_PASSWORD;

if (!email || !password || password.length < 8) {
  console.error(
    "用法：NEW_PASSWORD='至少8位' npx tsx scripts/set-password.ts user@example.com"
  );
  process.exit(1);
}

async function main() {
  const passwordHash = await hashPassword(password!);
  const user = await prisma.user.upsert({
    where: { email: email! },
    update: { passwordHash },
    create: { email: email!, passwordHash },
  });
  console.log(`[set-password] updated ${user.email}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[set-password] failed", err);
    process.exit(1);
  });