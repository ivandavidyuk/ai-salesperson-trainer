// Скрипт создания пользователя.
// Запуск: npm run create-user
// Запрашивает email, пароль, имя и фамилию в консоли,
// хэширует пароль через bcrypt и сохраняет пользователя в БД.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as readline from "readline";

const prisma = new PrismaClient();

// Утилита: задать вопрос в консоли и получить ответ.
// hideInput=true скрывает ввод (для пароля).
function ask(question: string, hideInput = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hideInput) {
      // Перехватываем вывод, чтобы не показывать вводимый пароль
      const rlAny = rl as unknown as {
        _writeToOutput: (s: string) => void;
        output: NodeJS.WriteStream;
      };
      rlAny._writeToOutput = function (stringToWrite: string) {
        if (stringToWrite.includes(question)) {
          rlAny.output.write(stringToWrite);
        } else {
          rlAny.output.write("*");
        }
      };
    }

    rl.question(question, (answer) => {
      rl.close();
      if (hideInput) {
        process.stdout.write("\n");
      }
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("=== Создание нового пользователя ===\n");

  const email = await ask("Email: ");
  const password = await ask("Пароль: ", true);
  const firstName = await ask("Имя: ");
  const lastName = await ask("Фамилия: ");

  // Простая валидация ввода
  if (!email || !password || !firstName || !lastName) {
    console.error("\nОшибка: все поля обязательны.");
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase();

  // Проверяем, что пользователь с таким email ещё не существует
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    console.error(`\nОшибка: пользователь с email ${normalizedEmail} уже существует.`);
    process.exit(1);
  }

  // Клиника. Регистрации в продукте нет, поэтому привязка происходит здесь:
  // сам менеджер организацию не выбирает — иначе попал бы в чужую статистику
  // отдела. Когда клиника одна, вопрос не задаём вовсе.
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, industry: true },
  });

  let organizationId: string | null = null;
  if (organizations.length === 1) {
    organizationId = organizations[0].id;
    console.log(`\nКлиника: ${organizations[0].name} (единственная)`);
  } else if (organizations.length > 1) {
    console.log("\nКлиники:");
    organizations.forEach((org, index) => {
      console.log(`  ${index + 1}. ${org.name} — ${org.industry}`);
    });
    const choice = Number(await ask("Номер клиники: "));
    const chosen = organizations[choice - 1];
    if (!chosen) {
      console.error("\nОшибка: такой клиники нет.");
      process.exit(1);
    }
    organizationId = chosen.id;
  } else {
    // Пустая база: пользователь создастся без клиники, и это честно —
    // выдумывать организацию скрипт не должен
    console.log("\nКлиник в базе нет — пользователь создаётся без привязки.");
  }

  // Хэшируем пароль (10 раундов соли — стандартный баланс скорость/безопасность)
  const passwordHash = await bcrypt.hash(password, 10);

  // Создаём пользователя
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      firstName,
      lastName,
      organizationId,
    },
  });

  console.log(`\nПользователь создан успешно:`);
  console.log(`  id:      ${user.id}`);
  console.log(`  email:   ${user.email}`);
  console.log(`  имя:     ${user.firstName} ${user.lastName}`);
  console.log(`  клиника: ${organizationId ? organizations.find((o) => o.id === organizationId)?.name : "не задана"}`);
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
