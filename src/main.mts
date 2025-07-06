import fetch from "node-fetch";
import { ContractTag, ITagService } from "atq-types";

const SUBGRAPH_URLS: Record<string, { decentralized: string }> = {
  // Ethereum, https://docs.uniswap.org/api/subgraph/overview
  "1": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G",
  },
  // Optimism, https://docs.uniswap.org/api/subgraph/overview
  "10": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/6RBtsmGUYfeLeZsYyxyKSUiaA6WpuC69shMEQ1Cfuj9u",
  },
  // BSC, https://docs.uniswap.org/api/subgraph/overview
  "56": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/2qQpC8inZPZL4tYfRQPFGZhsE8mYzE67n5z3Yf5uuKMu",
  },
  // Polygon, https://docs.uniswap.org/api/subgraph/overview
  "137": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND",
  },
  // Base, https://docs.uniswap.org/api/subgraph/overview
  "8453": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/HNCFA9TyBqpo5qpe6QreQABAA1kV8g46mhkCcicu6v2R",
  },
  // Arbitrum, https://docs.uniswap.org/api/subgraph/overview
  "42161": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/G5TsTKNi8yhPSV7kycaE23oWbqv9zzNqR49FoEQjzq1r",
  },
  // Avalanche, https://docs.uniswap.org/api/subgraph/overview
  "43114": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/49JxRo9FGxWpSf5Y5GKQPj5NUpX2HhpoZHpGzNEWQZjq",
  },
  // Blast, https://docs.uniswap.org/api/subgraph/overview
  "81457": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/FCHYK3Ab6bBnkfeCKRhFbs1Q8rX4yt6rKJibpDTC74ns",
  },
};

interface Pool {
  hooks: string;
}

interface GraphQLData {
  pools: Pool[];
}

interface GraphQLResponse {
  data?: GraphQLData;
  errors?: { message: string }[];
}

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

const GET_HOOKS_QUERY = `
query GetHooks($lastTimestamp: Int) {
  pools(
    first: 1000,
    orderBy: createdAtTimestamp,
    orderDirection: asc,
    where: { createdAtTimestamp_gt: $lastTimestamp, hooks_not: "0x0000000000000000000000000000000000000000" }
  ) {
    hooks
  }
}
`;

function isError(e: unknown): e is Error {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as Error).message === "string"
  );
}

function truncateId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 5)}...${id.slice(-5)}`;
}

async function fetchData(
  subgraphUrl: string,
  lastTimestamp: number
): Promise<Pool[]> {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: GET_HOOKS_QUERY,
      variables: { lastTimestamp },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors) {
    result.errors.forEach((error) => {
      console.error(`GraphQL error: ${error.message}`);
    });
    throw new Error("GraphQL errors occurred: see logs for details.");
  }

  if (!result.data || !result.data.pools) {
    throw new Error("No pools data found.");
  }

  return result.data.pools;
}

function prepareUrl(chainId: string, apiKey: string): string {
  const urls = SUBGRAPH_URLS[chainId];
  if (!urls || isNaN(Number(chainId))) {
    const supportedChainIds = Object.keys(SUBGRAPH_URLS).join(", ");

    throw new Error(
      `Unsupported or invalid Chain ID provided: ${chainId}. Only the following values are accepted: ${supportedChainIds}`
    );
  }
  return urls.decentralized.replace("[api-key]", encodeURIComponent(apiKey));
}

function transformPoolsToTags(chainId: string, pools: Pool[]): ContractTag[] {
  const uniqueHooks = new Set<string>();
  const tags: ContractTag[] = [];

  pools.forEach((pool) => {
    if (!uniqueHooks.has(pool.hooks)) {
      uniqueHooks.add(pool.hooks);
    }
  });

  Array.from(uniqueHooks).forEach((hook, index) => {
    const truncatedHook = truncateId(hook);
    tags.push({
      "Contract Address": `eip155:${chainId}:${hook}`,
      "Public Name Tag": `Hook #${index}`,
      "Project Name": "Uniswap v4",
      "UI/Website Link": "https://uniswap.org",
      "Public Note": `Uniswap V4's Hook #${index} contract`,
    });
  });

  return tags;
}

class TagService implements ITagService {
  returnTags = async (
    chainId: string,
    apiKey: string
  ): Promise<ContractTag[]> => {
    let lastTimestamp = 0;
    let allPools: Pool[] = [];
    let isMore = true;

    const url = prepareUrl(chainId, apiKey);

    while (isMore) {
      try {
        const pools = await fetchData(url, lastTimestamp);
        allPools.push(...pools);

        isMore = pools.length === 1000;
        if (isMore) {
          // Pagination disabled because createdAtTimestamp is not returned
          isMore = false;
        }
      } catch (error) {
        if (isError(error)) {
          console.error(`An error occurred: ${error.message}`);
          throw new Error(`Failed fetching data: ${error.message}`);
        } else {
          console.error("An unknown error occurred.");
          throw new Error("An unknown error occurred during fetch operation.");
        }
      }
    }
    return transformPoolsToTags(chainId, allPools);
  };
}

const tagService = new TagService();

export const returnTags = tagService.returnTags;

