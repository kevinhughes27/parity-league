// Contract test: public/openapi.json (served at /docs) must match the Worker.
// Both directions are checked, so the spec can't drift:
//   routes  — every route in worker/index.ts is documented, and vice versa
//   shapes  — every documented GET returns a body valid against the spec
// Runs against the real Worker + Durable Object, like api.test.ts.

import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import specJson from '../../public/openapi.json';
import workerSource from '../index.ts?raw';
import { leagues } from '../../shared/leagues';
import type { LeagueExport, Team } from '../../shared/types';
import rosters from '../../shared/fixtures/rosters.json';
import miniGame from '../../shared/fixtures/mini_game.json';
import miniGame2 from '../../shared/fixtures/mini_game2.json';

const spec = specJson as any;
const league = leagues[0];
const api = `http://parity.test/api/${league.id}`;
const admin = { Authorization: 'Basic ' + btoa('admin:test') };

const request = (url: string, init?: RequestInit) => exports.default.fetch(url, init);
const send = (method: string, url: string, body: unknown, headers = {}) =>
  request(url, { method, body: JSON.stringify(body), headers });

// Same seed as api.test.ts: teams, matchups and two uploaded games
const teams: Team[] = Object.entries(rosters).map(([name, players], i) => ({
  id: i + 1,
  name,
  players: players.map((p, j) => ({ name: p, is_open: j % 3 !== 0 })),
}));

const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

const seed: LeagueExport = {
  version: 1,
  league,
  teams,
  matchups: [
    {
      id: 1,
      week: 1,
      homeTeamId: 1,
      awayTeamId: 2,
      gameStart: '2020-01-01T18:00:00',
      gameEnd: '2020-01-01T19:00:00',
    },
    {
      id: 2,
      week: 2,
      homeTeamId: 1,
      awayTeamId: 3,
      gameStart: `${tomorrow}T18:00:00`,
      gameEnd: `${tomorrow}T19:00:00`,
    },
  ],
  games: [],
};

beforeEach(async () => {
  await send('POST', `${api}/import`, seed, admin);
  await send('PUT', `${api}/games/one`, miniGame);
  await send('PUT', `${api}/games/two`, miniGame2);
});

// The routes are string literals in worker/index.ts: switch cases like
// 'GET teams' plus the ADMIN_ROUTES set. 'GET leagues' is an if, not a case.
const codeRoutes = new Set(
  [...workerSource.matchAll(/'(GET|PUT|POST|DELETE) ([a-z/:_]+)'/g)].map(m => `${m[1]} ${m[2]}`)
);
codeRoutes.add('GET leagues');

const routeOf = (path: string, method: string) =>
  `${method.toUpperCase()} ${
    path === '/api/leagues'
      ? 'leagues'
      : path.replace('/api/{league}/', '').replaceAll('{id}', ':id')
  }`;

const pathOf = (route: string): [string, string] => {
  const [method, resource] = route.split(' ');
  const path =
    resource === 'leagues' ? '/api/leagues' : `/api/{league}/${resource.replaceAll(':id', '{id}')}`;
  return [path, method.toLowerCase()];
};

describe('routes', () => {
  it('documents every route the Worker implements', () => {
    for (const route of codeRoutes) {
      const [path, method] = pathOf(route);
      expect(spec.paths[path]?.[method], route).toBeDefined();
    }
  });

  it('implements every route the spec documents', () => {
    for (const [path, ops] of Object.entries(spec.paths) as [string, any][]) {
      for (const method of Object.keys(ops)) {
        expect(codeRoutes.has(routeOf(path, method)), `${method} ${path}`).toBe(true);
      }
    }
  });
});

describe('responses', () => {
  // Rewrite local refs to the added spec document so ajv can resolve them
  const deref = (node: any): any =>
    typeof node !== 'object' || node === null
      ? node
      : Array.isArray(node)
        ? node.map(deref)
        : Object.fromEntries(
            Object.entries(node).map(([key, value]) => [
              key,
              key === '$ref' && typeof value === 'string' && value.startsWith('#')
                ? `spec${value}`
                : deref(value),
            ])
          );

  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(spec, 'spec');

  const urls: Record<string, string> = {
    '/api/leagues': 'http://parity.test/api/leagues',
    '/api/{league}/teams': `${api}/teams`,
    '/api/{league}/schedule': `${api}/schedule`,
    '/api/{league}/players': `${api}/players`,
    '/api/{league}/weeks': `${api}/weeks`,
    '/api/{league}/weeks/{id}': `${api}/weeks/1`,
    '/api/{league}/stats': `${api}/stats`,
    '/api/{league}/games': `${api}/games`,
    '/api/{league}/games/{id}': `${api}/games/one`,
    '/api/{league}/export': `${api}/export`,
  };

  it('exercises every documented GET', () => {
    const documented = Object.entries(spec.paths)
      .filter(([, ops]) => (ops as any).get)
      .map(([path]) => path)
      .sort();
    expect(Object.keys(urls).sort()).toEqual(documented);
  });

  it('returns bodies valid against the spec', async () => {
    for (const [path, url] of Object.entries(urls)) {
      const res = await request(url);
      expect(res.status, path).toBe(200);
      const schema = deref(
        spec.paths[path].get.responses['200'].content['application/json'].schema
      );
      const validate = ajv.compile(schema);
      expect(validate(await res.json()), `${path}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });
});
