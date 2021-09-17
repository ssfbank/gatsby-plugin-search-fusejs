const crypto = require('crypto');
const { GraphQLScalarType } = require('gatsby/graphql');
const Fuse = require('fuse.js');
const { writeFile } = require('fs/promises');
const { extname, join, basename } = require('path');

const SEARCH_INDEX_ID = `SearchIndex < Site`;
const SEARCH_INDEX_TYPE = `SiteSearchIndex`;
const parent = `___SOURCE___`;
const DEFAULT_NAMESPACE = '__defaultNamespace';

const md5 = (src) =>
  crypto
    .createHash(`md5`)
    .update(src)
    .digest(`hex`);

const createEmptySearchIndexNode = () => {
  return {
    id: SEARCH_INDEX_ID,
    parent,
    children: [],
    pages: [],
  };
};

const appendPage = ({ pages }, newPage) => {
  const newPages = [...pages, newPage];
  const content = JSON.stringify(newPage);
  return {
    id: SEARCH_INDEX_ID,
    parent,
    children: [],
    pages: newPages,
    internal: {
      type: SEARCH_INDEX_TYPE,
      content: content,
      contentDigest: md5(content),
    },
  };
};

const createOrGetIndex = async (
  node,
  cache,
  getNode,
  getNodesByType,
  getNodes,
  server,
  reporter,
  { resolvers, fuseOptions, useResolverNamespaces }
) => {
  const cacheKey = `${node.id}:fuse`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!fuseOptions || !fuseOptions.keys || !fuseOptions.keys.length) {
    reporter.error('Fusejs requires keys to be set in fuseOptions');
  }

  const createDoc = (_fieldResolvers, pageNode) => {
    const doc = {
      id: pageNode.id,
      date: pageNode.date,
      ...Object.keys(_fieldResolvers).reduce((prev, key) => {
        return {
          ...prev,
          [key]: _fieldResolvers[key](
            pageNode,
            getNode,
            getNodesByType,
            getNodes
          ),
        };
      }, {}),
    };
    return doc;
  };

  const documents = {};
  for (const pageId of node.pages) {
    const pageNode = getNode(pageId);
    const typeResolver = resolvers[pageNode.internal.type];
    if (useResolverNamespaces) {
      Object.keys(typeResolver).forEach((namespace) => {
        const fieldResolvers = typeResolver[namespace];
        if (fieldResolvers) {
          if (!documents[namespace]) {
            documents[namespace] = [];
          }

          documents[namespace].push(createDoc(fieldResolvers, pageNode));
        }
      });
    } else {
      if (typeResolver) {
        if (!documents[DEFAULT_NAMESPACE]) {
          documents[DEFAULT_NAMESPACE] = [];
        }

        documents[DEFAULT_NAMESPACE].push(createDoc(typeResolver, pageNode));
      }
    }
  }
  let fuse = {};
  if (useResolverNamespaces) {
    Object.keys(documents).forEach((namespace) => {
      const _index = Fuse.createIndex(
        fuseOptions.keys,
        documents[namespace],
        fuseOptions
      );

      fuse[namespace] = {
        documents: documents[namespace],
        index: _index,
      };
    });
  } else {
    const _index = Fuse.createIndex(
      fuseOptions.keys,
      documents[DEFAULT_NAMESPACE],
      fuseOptions
    );

    fuse = {
      documents: documents[DEFAULT_NAMESPACE],
      index: _index,
    };
  }

  await cache.set(cacheKey, fuse);
  return fuse;
};

const SearchIndex = new GraphQLScalarType({
  name: `${SEARCH_INDEX_TYPE}_Fuse`,
  description: `Serialized fusejs search index and documents`,
  parseValue() {
    throw new Error(`Not supported`);
  },
  serialize(value) {
    return value;
  },
  parseLiteral() {
    throw new Error(`Not supported`);
  },
});

exports.sourceNodes = async ({ getNodes, actions }) => {
  const { touchNode } = actions;

  const existingNodes = getNodes().filter(
    (n) => n.internal.owner === `@ssfbank/gatsby-plugin-search-fusejs`
  );
  existingNodes.forEach((n) => touchNode(n));
};

exports.onCreateNode = ({ node, actions, getNode }, { resolvers, filter }) => {
  if (Object.keys(resolvers).indexOf(node.internal.type) === -1) {
    return;
  }

  if (filter && !filter(node, getNode)) {
    return;
  }

  const { createNode } = actions;
  const searchIndex = getNode(SEARCH_INDEX_ID) || createEmptySearchIndexNode();
  const newSearchIndex = appendPage(searchIndex, node.id);

  createNode(newSearchIndex);
};

exports.setFieldsOnGraphQLNodeType = (
  { type, getNode, getNodesByType, getNodes, cache, reporter },
  pluginOptions
) => {
  if (type.name !== SEARCH_INDEX_TYPE) {
    return null;
  }

  return {
    fuse: {
      type: SearchIndex,
      resolve: (node, _opts, _3, server) =>
        createOrGetIndex(
          node,
          cache,
          getNode,
          getNodesByType,
          getNodes,
          server,
          reporter,
          pluginOptions
        ),
    },
  };
};

exports.onPostBuild = (context, pluginOptions) => {
  const { graphql, reporter } = context;
  if (!pluginOptions.copySerializationToFile) {
    return;
  }
  const fileName = join(
    '/public',
    `${basename(pluginOptions.copySerializationToFile, 'json')}.json`
  );

  return graphql(
    `
      {
        fuseSearchIndex: siteSearchIndex {
          fuse
        }
      }
    `
  )
    .then(({ data }) => {
      const fuse = data.fuseSearchIndex;

      const json = JSON.stringify(fuse);
      reporter.info(`Writing fuse index and documents to file ${fileName}`);
      return writeFile(fileName, json);
    })
    .catch((err) => {
      reporter.error('Writing of elasticlunr index to file failed.', err);
    });
};
