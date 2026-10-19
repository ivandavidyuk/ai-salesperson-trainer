// Сгенерировано scripts/help-shots.mjs (npm run help:shots) — руками не правим.
// Поменялся экран — перезапусти скрипт: снимки и места меток обновятся вместе.
// Метки — проценты от ширины и высоты кадра; ширина кадра — экран 390 px.

export interface Снимок {
  src: string;
  w: number;
  h: number;
  marks: [number, number][];
}

export type ИмяСнимка =
  | "type"
  | "pat"
  | "check"
  | "listen"
  | "sheet"
  | "review"
  | "tasks"
  | "stat"
  | "dossier"
  | "hours"
  | "company";

export const СНИМКИ: {
  медицина: Record<ИмяСнимка, Снимок>;
  // У недвижимости нет диагностики, а разбор — общий с клиникой
  недвижимость: Record<Exclude<ИмяСнимка, "sheet">, Снимок>;
} = {
  "медицина": {
    "type": {
      "src": "/howto/clinic/type.webp?v=8de1f861",
      "w": 390,
      "h": 668,
      "marks": [
        [10.8, 30.2],
        [10.8, 53.6]
      ]
    },
    "pat": {
      "src": "/howto/clinic/pat.webp?v=784d55e7",
      "w": 390,
      "h": 461,
      "marks": [
        [28.8, 43.2],
        [21.3, 74]
      ]
    },
    "check": {
      "src": "/howto/clinic/check.webp?v=d196f213",
      "w": 390,
      "h": 704,
      "marks": [
        [8.5, 45.1],
        [19.2, 48.8],
        [37.2, 81]
      ]
    },
    "listen": {
      "src": "/howto/clinic/listen.webp?v=673ef487",
      "w": 390,
      "h": 506,
      "marks": [
        [39.3, 32.1],
        [42.2, 91.7]
      ]
    },
    "sheet": {
      "src": "/howto/clinic/sheet.webp?v=a5446bd7",
      "w": 390,
      "h": 461,
      "marks": [
        [8.7, 29.1],
        [4.6, 40.1],
        [0.5, 69.6]
      ]
    },
    "review": {
      "src": "/howto/clinic/review.webp?v=ff5ce8e4",
      "w": 390,
      "h": 786,
      "marks": [
        [15.6, 15.6],
        [10.5, 25],
        [4.9, 80.9],
        [46.8, 94.7]
      ]
    },
    "tasks": {
      "src": "/howto/clinic/tasks.webp?v=37cfa4e3",
      "w": 390,
      "h": 366,
      "marks": [
        [38.7, 38.4]
      ]
    },
    "stat": {
      "src": "/howto/clinic/stat.webp?v=d7cea628",
      "w": 390,
      "h": 173,
      "marks": [
        [25.1, 64.4]
      ]
    },
    "dossier": {
      "src": "/howto/clinic/dossier.webp?v=5b1e8f90",
      "w": 390,
      "h": 418,
      "marks": [
        [0.5, 6.5]
      ]
    },
    "hours": {
      "src": "/howto/clinic/hours.webp?v=77768a12",
      "w": 390,
      "h": 301,
      "marks": [
        [4.9, 12.4]
      ]
    },
    "company": {
      "src": "/howto/clinic/company.webp?v=de3f70bf",
      "w": 390,
      "h": 288,
      "marks": [
        [4.9, 24.5]
      ]
    }
  },
  "недвижимость": {
    "type": {
      "src": "/howto/realty/type.webp?v=920a831d",
      "w": 390,
      "h": 668,
      "marks": [
        [10.8, 30.2],
        [10.8, 53.6]
      ]
    },
    "pat": {
      "src": "/howto/realty/pat.webp?v=3f127fc7",
      "w": 390,
      "h": 461,
      "marks": [
        [28.8, 43.2],
        [21.3, 74]
      ]
    },
    "check": {
      "src": "/howto/realty/check.webp?v=d196f213",
      "w": 390,
      "h": 704,
      "marks": [
        [8.5, 45.1],
        [19.2, 48.8],
        [37.2, 81]
      ]
    },
    "listen": {
      "src": "/howto/realty/listen.webp?v=94eb8aa8",
      "w": 390,
      "h": 468,
      "marks": [
        [39.3, 34.7],
        [42.2, 91]
      ]
    },
    "tasks": {
      "src": "/howto/realty/tasks.webp?v=37cfa4e3",
      "w": 390,
      "h": 366,
      "marks": [
        [38.7, 38.4]
      ]
    },
    "dossier": {
      "src": "/howto/realty/dossier.webp?v=177bb113",
      "w": 390,
      "h": 418,
      "marks": [
        [0.5, 6.5]
      ]
    },
    "hours": {
      "src": "/howto/realty/hours.webp?v=2c66d107",
      "w": 390,
      "h": 302,
      "marks": [
        [4.9, 12.4]
      ]
    },
    "company": {
      "src": "/howto/realty/company.webp?v=2ff61548",
      "w": 390,
      "h": 288,
      "marks": [
        [4.9, 24.5]
      ]
    },
    "review": {
      "src": "/howto/clinic/review.webp?v=ff5ce8e4",
      "w": 390,
      "h": 786,
      "marks": [
        [15.6, 15.6],
        [10.5, 25],
        [4.9, 80.9],
        [46.8, 94.7]
      ]
    },
    "stat": {
      "src": "/howto/clinic/stat.webp?v=d7cea628",
      "w": 390,
      "h": 173,
      "marks": [
        [25.1, 64.4]
      ]
    }
  }
};
