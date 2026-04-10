import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const TEMPLATES_DIR = join(homedir(), '.claude', 'templates');

function ensureDir(): void {
  if (!existsSync(TEMPLATES_DIR)) {
    mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

function listTemplates(): void {
  ensureDir();
  const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
  if (files.length === 0) {
    console.log('No templates found in ~/.claude/templates/');
    return;
  }
  for (const file of files) {
    const name = basename(file, '.md');
    const contents = readFileSync(join(TEMPLATES_DIR, file), 'utf8');
    const firstLine = contents.split('\n').find(l => l.trim()) ?? '';
    console.log(`${name}\t${firstLine}`);
  }
}

function newTemplate(name: string | undefined): void {
  if (!name) {
    console.error('Usage: templates new <name>');
    process.exit(1);
  }
  ensureDir();
  const filePath = join(TEMPLATES_DIR, `${name}.md`);
  if (existsSync(filePath)) {
    console.error(`Template "${name}" already exists at ${filePath}`);
    process.exit(1);
  }
  writeFileSync(filePath, `# ${name}\n\n`, 'utf8');
  console.log(`Created template: ${filePath}`);
}

export async function templatesMain(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
      listTemplates();
      break;
    case 'new':
      newTemplate(args[1]);
      break;
    case 'reply':
      console.log('template reply not yet implemented');
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: templates <new|list|reply>');
      process.exit(1);
  }
}
