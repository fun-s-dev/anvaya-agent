import { mkdir, writeFile } from 'node:fs/promises';

import { generateScenario, scenarioMutationCatalog, type ScenarioProfile } from '@anvaya/generator';

function argument(name: string, fallback: string, positionalIndex: number): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  return process.argv[2 + positionalIndex] ?? fallback;
}

async function main(): Promise<void> {
  const seed = Number(argument('seed', '42', 0));
  const size = Number(argument('size', '100', 1));
  const profile = argument('profile', 'clean', 2) as ScenarioProfile;
  const mutationArgument = argument('mutations', '', 3);
  const mutations = mutationArgument
    ? mutationArgument.split(',').map((mutation) => {
        if (!scenarioMutationCatalog.includes(mutation as (typeof scenarioMutationCatalog)[number])) {
          throw new Error(`Unknown mutation: ${mutation}`);
        }
        return mutation as (typeof scenarioMutationCatalog)[number];
      })
    : undefined;
  const scenario = generateScenario({ seed, size, profile, mutations });
  await mkdir('data/demo', { recursive: true });
  await writeFile('data/demo/operational-records.json', `${JSON.stringify(scenario.operationalRecords, null, 2)}\n`, 'utf8');
  await writeFile('data/demo/hidden-ground-truth.json', `${JSON.stringify(scenario.hiddenTruth, null, 2)}\n`, 'utf8');
  console.log(`Generated ${size} merchant records with seed ${seed} (${profile}).`);
}

void main();
