import { NumberFormat } from './number.type';

const commonProps = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  style: 'currency',
  currencyDisplay: 'symbol',
  useGrouping: true,
};

export const formats = [
  {
    label: 'Number',
    value: NumberFormat.Num,
  },
  {
    label: 'US dollar',
    value: NumberFormat.USD,
  },
  {
    label: 'Canadian dollar',
    value: NumberFormat.CanadianDollar,
  },
  {
    label: 'Euro',
    value: NumberFormat.EUR,
  },
  {
    label: 'Pound',
    value: NumberFormat.Pound,
  },
  {
    label: 'Yen',
    value: NumberFormat.Yen,
  },
  {
    label: 'Ruble',
    value: NumberFormat.Ruble,
  },
  {
    label: 'Rupee',
    value: NumberFormat.Rupee,
  },
  {
    label: 'Won',
    value: NumberFormat.Won,
  },
  {
    label: 'Yuan',
    value: NumberFormat.Yuan,
  },
  {
    label: 'Real',
    value: NumberFormat.Real,
  },
  {
    label: 'Lira',
    value: NumberFormat.Lira,
  },
  {
    label: 'Rupiah',
    value: NumberFormat.Rupiah,
  },
  {
    label: 'Franc',
    value: NumberFormat.Franc,
  },
  {
    label: 'Hong Kong dollar',
    value: NumberFormat.HongKongDollar,
  },
  {
    label: 'New Zealand dollar',
    value: NumberFormat.NewZealandDollar,
  },
  {
    label: 'Krona',
    value: NumberFormat.Krona,
  },
  {
    label: 'Norwegian krone',
    value: NumberFormat.NorwegianKrone,
  },
  {
    label: 'Danish krone',
    value: NumberFormat.DanishKrone,
  },
  {
    label: 'Baht',
    value: NumberFormat.Baht,
  },
  {
    label: 'Forint',
    value: NumberFormat.Forint,
  },
  {
    label: 'Koruna',
    value: NumberFormat.Koruna,
  },
  {
    label: 'Shekel',
    value: NumberFormat.Shekel,
  },
  {
    label: 'Cheilean peso',
    value: NumberFormat.ChileanPeso,
  },
  {
    label: 'Philippine peso',
    value: NumberFormat.PhilippinePeso,
  },
  {
    label: 'Dirham',
    value: NumberFormat.Dirham,
  },
  {
    label: 'Colombian peso',
    value: NumberFormat.ColombianPeso,
  },
  {
    label: 'Riyal',
    value: NumberFormat.Riyal,
  },
  {
    label: 'Ringgit',
    value: NumberFormat.Ringgit,
  },
  {
    label: 'Leu',
    value: NumberFormat.Leu,
  },
  {
    label: 'Argentine peso',
    value: NumberFormat.ArgentinePeso,
  },
  {
    label: 'Uruguayan peso',
    value: NumberFormat.UruguayanPeso,
  },
  {
    label: 'Percent',
    value: NumberFormat.Percent,
  },

];

export const currencyFormaterMap: Record<NumberFormat, (n: bigint | number) => string> = {
  [NumberFormat.Num]: (n: bigint | number) =>
    new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 20,
      useGrouping: false,
    }).format(n),
  [NumberFormat.Percent]: (n: bigint | number) =>
    new Intl.NumberFormat('en-US', {
      ...commonProps,
      style: 'decimal',
    }).format(n) + '%',
  [NumberFormat.USD]: (n: bigint | number) =>
    new Intl.NumberFormat('en-US', {
      ...commonProps,
      currency: 'USD',
    }).format(n),
  [NumberFormat.CanadianDollar]: (n: bigint | number) =>
    new Intl.NumberFormat('en-CA', {
      ...commonProps,
      currency: 'CAD',
    })
      .format(n)
      .replace('$', 'CA$'),
  [NumberFormat.EUR]: (n: bigint | number) => {
    const formattedAmount = new Intl.NumberFormat('de-DE', {
      ...commonProps,
      currency: 'EUR',
    })
      .format(n)
      .replace('€', '')
      .trim();

    return `€${formattedAmount}`;
  },

  [NumberFormat.Pound]: (n: bigint | number) =>
    new Intl.NumberFormat('en-GB', {
      ...commonProps,
      currency: 'GBP',
    }).format(n),
  [NumberFormat.Yen]: (n: bigint | number) =>
    new Intl.NumberFormat('ja-JP', {
      ...commonProps,
      currency: 'JPY',
    }).format(n),
  [NumberFormat.Ruble]: (n: bigint | number) =>
    new Intl.NumberFormat('ru-RU', {
      ...commonProps,
      currency: 'RUB',
      currencyDisplay: 'code',
    })
      .format(n)
      .replaceAll(' ', ' '),
  [NumberFormat.Rupee]: (n: bigint | number) =>
    new Intl.NumberFormat('hi-IN', {
      ...commonProps,
      currency: 'INR',
    }).format(n),
  [NumberFormat.Won]: (n: bigint | number) =>
    new Intl.NumberFormat('ko-KR', {
      ...commonProps,
      currency: 'KRW',
    }).format(n),
  [NumberFormat.Yuan]: (n: bigint | number) =>
    new Intl.NumberFormat('zh-CN', {
      ...commonProps,
      currency: 'CNY',
    })
      .format(n)
      .replace('¥', 'CN¥'),
  [NumberFormat.Real]: (n: bigint | number) =>
    new Intl.NumberFormat('pt-BR', {
      ...commonProps,
      currency: 'BRL',
    })
      .format(n)
      .replaceAll(' ', ' '),
  [NumberFormat.Lira]: (n: bigint | number) =>
    new Intl.NumberFormat('tr-TR', {
      ...commonProps,
      currency: 'TRY',
      currencyDisplay: 'code',
    })
      .format(n)
      .replaceAll(' ', ' '),
  [NumberFormat.Rupiah]: (n: bigint | number) =>
    new Intl.NumberFormat('id-ID', {
      ...commonProps,
      currency: 'IDR',
      currencyDisplay: 'code',
    })
      .format(n)
      .replaceAll(' ', ' '),
  [NumberFormat.Franc]: (n: bigint | number) =>
    new Intl.NumberFormat('de-CH', {
      ...commonProps,
      currency: 'CHF',
    })
      .format(n)
      .replaceAll(' ', ' '),
  [NumberFormat.HongKongDollar]: (n: bigint | number) =>
    new Intl.NumberFormat('zh-HK', {
      ...commonProps,
      currency: 'HKD',
    }).format(n),
  [NumberFormat.NewZealandDollar]: (n: bigint | number) =>
    new Intl.NumberFormat('en-NZ', {
      ...commonProps,
      currency: 'NZD',
    })
      .format(n)
      .replace('$', 'NZ$'),
  [NumberFormat.Krona]: (n: bigint | number) =>
    new Intl.NumberFormat('sv-SE', {
      ...commonProps,
      currency: 'SEK',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.NorwegianKrone]: (n: bigint | number) =>
    new Intl.NumberFormat('nb-NO', {
      ...commonProps,
      currency: 'NOK',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.MexicanPeso]: (n: bigint | number) =>
    new Intl.NumberFormat('es-MX', {
      ...commonProps,
      currency: 'MXN',
    })
      .format(n)
      .replace('$', 'MX$'),
  [NumberFormat.Rand]: (n: bigint | number) =>
    new Intl.NumberFormat('en-ZA', {
      ...commonProps,
      currency: 'ZAR',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.NewTaiwanDollar]: (n: bigint | number) =>
    new Intl.NumberFormat('zh-TW', {
      ...commonProps,
      currency: 'TWD',
    })
      .format(n)
      .replace('$', 'NT$'),
  [NumberFormat.DanishKrone]: (n: bigint | number) =>
    new Intl.NumberFormat('da-DK', {
      ...commonProps,
      currency: 'DKK',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.Baht]: (n: bigint | number) =>
    new Intl.NumberFormat('th-TH', {
      ...commonProps,
      currency: 'THB',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.Forint]: (n: bigint | number) =>
    new Intl.NumberFormat('hu-HU', {
      ...commonProps,
      currency: 'HUF',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.Koruna]: (n: bigint | number) =>
    new Intl.NumberFormat('cs-CZ', {
      ...commonProps,
      currency: 'CZK',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.Shekel]: (n: bigint | number) =>
    new Intl.NumberFormat('he-IL', {
      ...commonProps,
      currency: 'ILS',
    }).format(n),
  [NumberFormat.ChileanPeso]: (n: bigint | number) =>
    new Intl.NumberFormat('es-CL', {
      ...commonProps,
      currency: 'CLP',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.PhilippinePeso]: (n: bigint | number) =>
    new Intl.NumberFormat('fil-PH', {
      ...commonProps,
      currency: 'PHP',
    }).format(n),
  [NumberFormat.Dirham]: (n: bigint | number) =>
    new Intl.NumberFormat('ar-AE', {
      ...commonProps,
      currency: 'AED',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.ColombianPeso]: (n: bigint | number) =>
    new Intl.NumberFormat('es-CO', {
      ...commonProps,
      currency: 'COP',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.Riyal]: (n: bigint | number) =>
    new Intl.NumberFormat('en-US', {
      ...commonProps,
      currency: 'SAR',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.Ringgit]: (n: bigint | number) =>
    new Intl.NumberFormat('ms-MY', {
      ...commonProps,
      currency: 'MYR',
    }).format(n),
  [NumberFormat.Leu]: (n: bigint | number) =>
    new Intl.NumberFormat('ro-RO', {
      ...commonProps,
      currency: 'RON',
    }).format(n),
  [NumberFormat.ArgentinePeso]: (n: bigint | number) =>
    new Intl.NumberFormat('es-AR', {
      ...commonProps,
      currency: 'ARS',
      currencyDisplay: 'code',
    }).format(n),
  [NumberFormat.UruguayanPeso]: (n: bigint | number) =>
    new Intl.NumberFormat('es-UY', {
      ...commonProps,
      currency: 'UYU',
      currencyDisplay: 'code',
    }).format(n),
};
