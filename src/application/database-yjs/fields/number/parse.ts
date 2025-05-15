import { currencyFormaterMap } from '@/application/database-yjs';
import { YDatabaseField } from '@/application/types';
import Decimal from 'decimal.js';
import { getTypeOptions } from '../type_option';
import { NumberFormat } from './number.type';

export function parseNumberTypeOptions (field: YDatabaseField) {
  const numberTypeOption = getTypeOptions(field)?.toJSON();

  if (!numberTypeOption) {
    return {
      format: NumberFormat.Num,
    };
  }

  return {
    format: parseInt(numberTypeOption.format) as NumberFormat,
  };
}

export function getFormatValue (data: string, format: NumberFormat) {
  if (data === undefined || data === null) return '';

  const numberFormater = currencyFormaterMap[format];

  const newData = valueToNumberParser(data);
  
  if (!numberFormater) return newData;

  if (isNaN(parseInt(newData))) return '';

  return numberFormater(new Decimal(newData).toNumber());
}

export function valueToNumberParser (input: string): string {
  const scientificMatch = /^([0-9]+\.?[0-9]*)[eE]([+-]?[0-9]+)/.exec(input);

  if (scientificMatch) {
    return parseFloat(scientificMatch[0]).toString();
  }

  // 尝试匹配普通数字
  const numericMatch = /^([0-9]+\.?[0-9]*)/.exec(input);

  if (numericMatch) {
    return parseFloat(numericMatch[0]).toString();
  }

  const allDigits = input.replace(/[^0-9]/g, '');

  if (allDigits.length > 0) {
    return parseInt(allDigits, 10).toString();
  }

  return '';
}