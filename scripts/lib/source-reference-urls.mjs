const DESTINATION_SHAPES = [
  [/^\/?$/u, 'repository'],
  [/^\/archive\/refs\/heads\/.+\.zip$/u, 'zip'],
  [/^\/blob\/.+\/src\/registry\.json$/u, 'registry'],
  [/^\/blob\/.+\/AGENTS\.md$/u, 'agents'],
  [/^\/tree\/.+\/\.agents\/skills\/?$/u, 'skills'],
];
const UPSTREAM = ['https://github.com/holger1411/vibe2prod'];

function githubDestination(actual) {
  let url;
  try {
    url = new URL(actual);
  } catch {
    return undefined;
  }
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return undefined;
  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)(\/.*)?$/u);
  if (!match) return undefined;
  const [, owner, repository, suffix = ''] = match;
  return {
    url,
    repository: `${owner}/${repository.replace(/\.git$/iu, '')}`.toLowerCase(),
    path: `/${owner.toLowerCase()}/${repository.toLowerCase()}`,
    suffix,
  };
}

function repositoryKeys(repositories) {
  return repositories.flatMap((repository) => {
    const destination = githubDestination(repository);
    return destination ? [destination.repository] : [];
  });
}

export function sourceReferencePolicy({
  repository,
  formerRepositories = [],
  upstreamRepositories = [],
} = {}) {
  const repositories = new Set(repositoryKeys([repository, ...formerRepositories]));
  return {
    repositories,
    repositoryLabels: repositories,
    upstream: new Set(repositoryKeys([...UPSTREAM, ...upstreamRepositories])),
  };
}

export function sourceDestinationKind(actual, policy) {
  const destination = githubDestination(actual);
  if (!destination || policy.upstream.has(destination.repository)) return undefined;
  if (!policy.repositories.has(destination.repository)) return undefined;
  return DESTINATION_SHAPES.find(([pattern]) => pattern.test(destination.suffix))?.[1];
}

export function knownSourceClone(actual, policy) {
  // The clone grammar remains in source-clones; only recognize common remote identities here.
  const remote = actual.replace(/^git@((?:www\.)?github\.com):/iu, 'ssh://git@$1/');
  const destination = githubDestination(remote);
  return (
    !!destination &&
    policy.repositories.has(destination.repository) &&
    !policy.upstream.has(destination.repository)
  );
}

function comparableDestination(actual) {
  const destination = githubDestination(actual);
  if (!destination) return actual;
  const { url, path, suffix } = destination;
  url.hostname = 'github.com';
  url.hash = '';
  const trailingSlash =
    !suffix || suffix === '/' || /\/tree\/.+\/\.agents\/skills\/$/u.test(suffix);
  url.pathname = `${path}${trailingSlash ? suffix.replace(/\/$/u, '') : suffix}`;
  return url.href;
}

export function sameSourceDestination(actual, expected) {
  return comparableDestination(actual) === comparableDestination(expected);
}
