// Сгенерировано scripts/help-shots.mjs (npm run help:shots) — руками не правим.
// Поменялся экран — перезапусти скрипт: снимки и места меток обновятся вместе.
// Два набора: телефон (экран 390 px) и компьютер (1440×900, кадр вырезан
// по окну или карточке). Метки — проценты от ширины и высоты кадра.

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

export type Устройство = "телефон" | "компьютер";

type Набор<Имя extends string> = Record<Устройство, Record<Имя, Снимок>>;

export const СНИМКИ: {
  медицина: Набор<ИмяСнимка>;
  // У недвижимости нет диагностики, а разбор и статистика — общие с клиникой
  недвижимость: Набор<Exclude<ИмяСнимка, "sheet">>;
} = {
  "медицина": {
    "телефон": {
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
        "src": "/howto/clinic/pat.webp?v=05e30dd2",
        "w": 390,
        "h": 461,
        "marks": [
          [28.8, 43.2],
          [21.3, 74]
        ]
      },
      "check": {
        "src": "/howto/clinic/check.webp?v=39123a38",
        "w": 390,
        "h": 656,
        "marks": [
          [8.5, 33.7],
          [19.2, 37.7],
          [37.2, 79.6]
        ]
      },
      "listen": {
        "src": "/howto/clinic/listen.webp?v=673ef487",
        "w": 390,
        "h": 506,
        "marks": [
          [27.5, 32.1],
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
        "src": "/howto/clinic/hours.webp?v=139a74eb",
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
    "компьютер": {
      "type": {
        "src": "/howto/clinic/desk-type.webp?v=df13d118",
        "w": 660,
        "h": 648,
        "marks": [
          [7.6, 35.6],
          [7.6, 57.2]
        ]
      },
      "pat": {
        "src": "/howto/clinic/desk-pat.webp?v=6218e48e",
        "w": 660,
        "h": 449,
        "marks": [
          [12.9, 49.4],
          [13.2, 68.6]
        ]
      },
      "check": {
        "src": "/howto/clinic/desk-check.webp?v=d478de8c",
        "w": 504,
        "h": 543,
        "marks": [
          [9.7, 41.7],
          [20.1, 45.7],
          [26, 85.8]
        ]
      },
      "listen": {
        "src": "/howto/clinic/desk-listen.webp?v=82fa3318",
        "w": 726,
        "h": 490,
        "marks": [
          [37.9, 69.8],
          [61.3, 88.3]
        ]
      },
      "sheet": {
        "src": "/howto/clinic/desk-sheet.webp?v=aa6aec61",
        "w": 482,
        "h": 577,
        "marks": [
          [5, 16.7],
          [7.9, 24.1],
          [4.6, 47.6]
        ]
      },
      "review": {
        "src": "/howto/clinic/desk-review.webp?v=9172259d",
        "w": 542,
        "h": 732,
        "marks": [
          [13.5, 24.1],
          [9.9, 34.1],
          [5.8, 91.5],
          [64.2, 4.4]
        ]
      },
      "stat": {
        "src": "/howto/clinic/desk-stat.webp?v=a45522dc",
        "w": 1172,
        "h": 599,
        "marks": [
          [39.3, 84]
        ]
      },
      "tasks": {
        "src": "/howto/clinic/desk-tasks.webp?v=bb31df0e",
        "w": 948,
        "h": 312,
        "marks": [
          [86.2, 15.5]
        ]
      },
      "dossier": {
        "src": "/howto/clinic/desk-dossier.webp?v=c026b2a9",
        "w": 640,
        "h": 398,
        "marks": [
          [1.3, 6.7]
        ]
      },
      "hours": {
        "src": "/howto/clinic/desk-hours.webp?v=a919c045",
        "w": 812,
        "h": 244,
        "marks": [
          [1.4, 18.1]
        ]
      },
      "company": {
        "src": "/howto/clinic/desk-company.webp?v=aebc1e12",
        "w": 812,
        "h": 308,
        "marks": [
          [1.4, 14.2]
        ]
      }
    }
  },
  "недвижимость": {
    "телефон": {
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
        "src": "/howto/realty/check.webp?v=39123a38",
        "w": 390,
        "h": 656,
        "marks": [
          [8.5, 33.7],
          [19.2, 37.7],
          [37.2, 79.6]
        ]
      },
      "listen": {
        "src": "/howto/realty/listen.webp?v=94eb8aa8",
        "w": 390,
        "h": 468,
        "marks": [
          [27.5, 34.7],
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
        "src": "/howto/realty/hours.webp?v=e7931b74",
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
    },
    "компьютер": {
      "type": {
        "src": "/howto/realty/desk-type.webp?v=f7d599df",
        "w": 660,
        "h": 648,
        "marks": [
          [7.6, 35.6],
          [7.6, 57.2]
        ]
      },
      "pat": {
        "src": "/howto/realty/desk-pat.webp?v=8b1760a1",
        "w": 660,
        "h": 449,
        "marks": [
          [12.9, 49.4],
          [13.2, 68.6]
        ]
      },
      "check": {
        "src": "/howto/realty/desk-check.webp?v=d478de8c",
        "w": 504,
        "h": 543,
        "marks": [
          [9.7, 41.7],
          [20.1, 45.7],
          [26, 85.8]
        ]
      },
      "listen": {
        "src": "/howto/realty/desk-listen.webp?v=5b0f412f",
        "w": 450,
        "h": 490,
        "marks": [
          [30.5, 69.8],
          [37.4, 88.3]
        ]
      },
      "tasks": {
        "src": "/howto/realty/desk-tasks.webp?v=bb31df0e",
        "w": 948,
        "h": 312,
        "marks": [
          [86.2, 15.5]
        ]
      },
      "dossier": {
        "src": "/howto/realty/desk-dossier.webp?v=8d35919a",
        "w": 640,
        "h": 398,
        "marks": [
          [1.3, 6.8]
        ]
      },
      "hours": {
        "src": "/howto/realty/desk-hours.webp?v=a15f77d0",
        "w": 812,
        "h": 244,
        "marks": [
          [1.4, 18]
        ]
      },
      "company": {
        "src": "/howto/realty/desk-company.webp?v=69d679a0",
        "w": 812,
        "h": 308,
        "marks": [
          [1.4, 14.2]
        ]
      },
      "review": {
        "src": "/howto/clinic/desk-review.webp?v=9172259d",
        "w": 542,
        "h": 732,
        "marks": [
          [13.5, 24.1],
          [9.9, 34.1],
          [5.8, 91.5],
          [64.2, 4.4]
        ]
      },
      "stat": {
        "src": "/howto/clinic/desk-stat.webp?v=a45522dc",
        "w": 1172,
        "h": 599,
        "marks": [
          [39.3, 84]
        ]
      }
    }
  }
};
