import { LetterboxdEntry } from '../types.ts';

export const parseCSV = (text: string): LetterboxdEntry[] => {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  
  const result: LetterboxdEntry[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const row: string[] = [];
    let inQuote = false;
    let temp = '';
    
    for(const char of line) {
        if(char === '"') { 
            inQuote = !inQuote; 
            continue; 
        }
        if(char === ',' && !inQuote) { 
            row.push(temp); 
            temp = ''; 
            continue; 
        }
        temp += char;
    }
    row.push(temp);
    
    if (row.length >= headers.length) {
      const obj: any = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx]?.trim();
      });
      result.push(obj as LetterboxdEntry);
    }
  }
  return result;
};