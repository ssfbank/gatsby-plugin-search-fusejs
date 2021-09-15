import { createHash } from "crypto"
import { GraphQLScalarType } from "gatsby/graphql"
import Fuse from "fuse.js"

const SEARCH_INDEX_ID = `SearchIndex < Site`
const SEARCH_INDEX_TYPE = `SiteSearchIndex`
const parent = `___SOURCE___`

const md5 = src =>
  createHash(`md5`)
    .update(src)
    .digest(`hex`)

const createEmptySearchIndexNode = () => {
  return {
    id: SEARCH_INDEX_ID,
    parent,
    children: [],
    pages: [],
  }
}

const appendPage = ({ pages }, newPage) => {
  const newPages = [...pages, newPage]
  const content = JSON.stringify(newPage)
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
  }
}

const createOrGetIndex = async (
  node,
  cache,
  getNode,
  getNodesByType,
  getNodes,
  server,
  { fields, resolvers, fuseOptions }
) => {
  const cacheKey = `${node.id}:index`
  const cached = await cache.get(cacheKey)
  if (cached) {
    return cached
  }

  const documents = []

  for (const pageId of node.pages) {
    const pageNode = getNode(pageId)

    const fieldResolvers = resolvers[pageNode.internal.type]
    if (fieldResolvers) {
      const doc = {
        id: pageNode.id,
        date: pageNode.date,
        ...Object.keys(fieldResolvers).reduce((prev, key) => {
          return {
            ...prev,
            [key]: fieldResolvers[key](
              pageNode,
              getNode,
              getNodesByType,
              getNodes
            ),
          }
        }, {}),
      }

      documents.push(doc)
    }
  }

  const index = Fuse.createIndex(fields, documents, fuseOptions)
  const indexJSON = JSON.stringify(index)

  await cache.set(cacheKey, indexJSON)
  return indexJSON
}

const SearchIndex = new GraphQLScalarType({
  name: `${SEARCH_INDEX_TYPE}_Index`,
  description: `Serialized FUSEJS search index`,
  parseValue() {
    throw new Error(`Not supported`)
  },
  serialize(value) {
    return value
  },
  parseLiteral() {
    throw new Error(`Not supported`)
  },
})

exports.sourceNodes = async ({ getNodes, actions }) => {
  const { touchNode } = actions

  const existingNodes = getNodes().filter(
    n => n.internal.owner === `@ssfbank/gatsby-plugin-search-fusej`
  )
  existingNodes.forEach(n => touchNode({ nodeId: n.id }))
}

exports.onCreateNode = ({ node, actions, getNode }, { resolvers, filter }) => {
  if (Object.keys(resolvers).indexOf(node.internal.type) === -1) {
    return
  }

  if (filter && !filter(node, getNode)) {
    return
  }

  const { createNode } = actions
  const searchIndex = getNode(SEARCH_INDEX_ID) || createEmptySearchIndexNode()
  const newSearchIndex = appendPage(searchIndex, node.id)
  createNode(newSearchIndex)
}

exports.setFieldsOnGraphQLNodeType = (
  { type, getNode, getNodesByType, getNodes, cache },
  pluginOptions
) => {
  if (type.name !== SEARCH_INDEX_TYPE) {
    return null
  }

  return {
    index: {
      type: SearchIndex,
      resolve: (node, _opts, _3, server) =>
        createOrGetIndex(
          node,
          cache,
          getNode,
          getNodesByType,
          getNodes,
          server,
          pluginOptions
        ),
    },
  }
}
