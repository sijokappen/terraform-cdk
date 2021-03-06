import * as fs from 'fs-extra';
import * as path from 'path';
import { CodeMaker } from 'codemaker';
import { withTempDir, shell } from '../util';
import { jsiiCompile } from './jsii';
import { TerraformProviderConstraint } from './generator/provider-generator';

export enum Language {
  TYPESCRIPT = 'typescript',
  PYTHON = 'python',
  DOTNET = 'dotnet',
  JAVA = 'java',
}

export const LANGUAGES = [ Language.TYPESCRIPT, Language.PYTHON ];

export interface GetOptions {
  readonly targetLanguage: Language;
  readonly codeMakerOutput: string;
  readonly targetNames: string[];
  readonly isModule?: boolean;
}

export abstract class GetBase {
  protected abstract async generateTypeScript(code: CodeMaker, targetNames: string[], output: string): Promise<void>;

  public async get(options: GetOptions) {
    const code = new CodeMaker();

    const { isModule = false } = options;
    const codeMakerOutdir = path.resolve(options.codeMakerOutput);
    await fs.mkdirp(codeMakerOutdir);
    const isTypescript = options.targetLanguage === Language.TYPESCRIPT
    await this.generateTypeScript(code, options.targetNames, codeMakerOutdir);

    if (isTypescript) {
      await code.save(codeMakerOutdir);
      return
    }

    for (const name of options.targetNames) {
      // this is not typescript, so we generate in a staging directory and harvest the code
      await withTempDir('get', async () => {
        const terraformProvider = new TerraformProviderConstraint(name)
        const source = isModule ? terraformProvider.fqn : terraformProvider.name;
        const compatibleName = source.replace(/\//gi, '_')
        await code.save('.');
        await jsiiCompile('.', {
          main: source,
          name: compatibleName,
          providerPath: this.typesPath(source)
        });

        const pacmak = require.resolve('jsii-pacmak/bin/jsii-pacmak');
        await shell(pacmak, [ '--target', options.targetLanguage, '--code-only' ]);
        await this.harvestCode(options, codeMakerOutdir, source.replace(/-/gi, '_'));
      });
    }
  }

  private async harvestCode(options: GetOptions, targetdir: string, targetName: string) {
    switch (options.targetLanguage) {
      case Language.TYPESCRIPT:
        throw new Error('no op for typescript');

      case Language.PYTHON:
        await this.harvestPython(targetdir, targetName);
        break;

      default:
        throw new Error(`unsupported language ${options.targetLanguage} (yet)`);
    }
  }

  private async harvestPython(targetdir: string, targetName: string) {
    const target = path.join(targetdir, targetName);
    await fs.move(`dist/python/src/${targetName}`, target, { overwrite: true });
    // Make the codeMakerOutput dir a Python package for IDEs and linting
    fs.writeFileSync(path.join(targetdir, '__init__.py'), '', 'utf-8');
  }

  protected abstract typesPath(name: string): string;
}
