// Скрипт создания пользователя.
// Запуск: npx ts-node create-user.ts
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

  // Хэшируем пароль (10 раундов соли — стандартный баланс скорость/безопасность)
  const passwordHash = await bcrypt.hash(password, 10);

  // Создаём пользователя
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      firstName,
      lastName,
    },
  });

  console.log(`\nПользователь создан успешно:`);
  console.log(`  id:    ${user.id}`);
  console.log(`  email: ${user.email}`);
  console.log(`  имя:   ${user.firstName} ${user.lastName}`);
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
