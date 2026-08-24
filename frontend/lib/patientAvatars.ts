// Портреты пациентов: имя на экране → файл в public/portraits/.
//
// Ключ — имя, а не колонка в базе, потому что именем пациент уже опознаётся
// по всему проекту: сид ищет и чистит пациентов по имени (`removeStale`
// в scripts/seed-patients.ts), по имени же собран LAYERED_ROLES. И главное —
// имя есть во всех местах вывода: где-то это `patient.name` из роута, где-то
// денормализованное `patientName` из lib/home.ts. Колонка потребовала бы
// миграции и правки роутов ради того же результата.
//
// Лица нарисованы моделью по личностям из scripts/patients/ — люди
// вымышленные. Скрипт сборки: backend/scripts/make_portraits.py.
//
// Расхождение карты со списком пациентов и с файлами ловит `npm run
// check:avatars` — без него первый же новый пациент останется без портрета
// молча.

/** Порядок — как в scripts/patients/index.ts, чтобы сверять глазами */
export const PATIENT_PORTRAITS: Record<string, string> = {
  "Тамара Михайловна": "tamara-sokolova",
  "Юлия Андреевна": "yulia-tkachenko",
  "Виталий Эдуардович": "vitaly-kuznetsov",
  "Рустам Каримович": "rustam-aliev",
  "Ван Хао": "van-hao",
  "Николай Васильевич": "nikolay-baranov",
  "Борис Семёнович": "boris-kaplan",
  "Оксана Викторовна": "oksana-kuznetsova",
  "Анжелика Сергеевна": "anzhelika-kravtsova",
  "Игорь Владимирович": "igor-mitin",
  "Станислав Геннадьевич": "stanislav-shvets",
  "Гульсара Рустамовна": "gulsara-karimova",
  "Джамшид Толибович": "dzhamshid-akhmedov",
  "Леонид Петрович": "leonid-gromov",
  "Егор Алексеевич": "egor-borisov",
  "Михаил Данилович": "mikhail-kravtsov",
  "Елена Андреевна": "elena-voroshilova",
  "Галина Петровна": "galina-zaytseva",
  "Роман Игоревич": "roman-savelyev",
  "Григорий Игоревич": "grigory-logvinov",
  "Мария Андреевна": "maria-slavnova",
};

/**
 * Путь к портрету или `null`, если его нет.
 *
 * Null — не исключение: пациент без портрета выглядит как раньше, кружком
 * с инициалами. Так новый пациент попадает в интерфейс сразу, а не сломанной
 * картинкой.
 */
export function portraitFor(name: string | null | undefined): string | null {
  if (!name) return null;
  const slug = PATIENT_PORTRAITS[name.trim()];
  return slug ? `/portraits/${slug}.webp` : null;
}
