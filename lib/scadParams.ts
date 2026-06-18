export type ScadParam = {
  name: string;
  value: number;
  comment: string;
};

const PARAM_ASSIGNMENT =
  /^\s*([$A-Za-z_][\w$]*)\s*=\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*;\s*(?:(?:\/\/\s*(.*))|(?:\/\*\s*(.*?)\s*\*\/\s*))?$/;
const PARAM_REPLACEMENT =
  /^(\s*)([$A-Za-z_][\w$]*)(\s*=\s*)(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)(\s*;.*)$/;
const MODULE_OR_FUNCTION = /^\s*(module|function)\b/;

export function parseScadParams(scadCode: string): ScadParam[] {
  return getScadHeaderLines(scadCode)
    .map((line) => {
      const match = line.match(PARAM_ASSIGNMENT);
      if (!match) return null;

      const value = Number(match[2]);
      if (!Number.isFinite(value)) return null;

      return {
        name: match[1],
        value,
        comment: (match[3] ?? match[4] ?? '').trim(),
      };
    })
    .filter((param): param is ScadParam => param !== null);
}

export function applyScadParams(
  scadCode: string,
  params: { name: string; value: number }[]
): string {
  const paramMap = new Map(params.map((param) => [param.name, param.value]));
  const newline = scadCode.includes('\r\n') ? '\r\n' : '\n';
  const lines = scadCode.split(/\r?\n/);
  let pastHeader = false;

  const updatedLines = lines.map((line) => {
    if (!pastHeader && MODULE_OR_FUNCTION.test(line)) {
      pastHeader = true;
    }

    if (pastHeader) {
      return line;
    }

    const match = line.match(PARAM_REPLACEMENT);
    if (!match) {
      return line;
    }

    const nextValue = paramMap.get(match[2]);
    if (nextValue === undefined) {
      return line;
    }

    return `${match[1]}${match[2]}${match[3]}${formatNumericValue(nextValue)}${match[5]}`;
  });

  return updatedLines.join(newline);
}

function getScadHeaderLines(scadCode: string): string[] {
  const lines = scadCode.split(/\r?\n/);
  const headerLines: string[] = [];

  for (const line of lines) {
    if (MODULE_OR_FUNCTION.test(line)) {
      break;
    }
    headerLines.push(line);
  }

  return headerLines;
}

function formatNumericValue(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}
