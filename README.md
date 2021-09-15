# FUSEJS Search Plugin for Gatsby

This is a fork of [gatsby-plugin-elasticlunr-search](https://github.com/andrew-codes/gatsby-plugin-elasticlunr-search) made in order to use Fusejs in gatsby.

elasticlunr is unmaintained, and fusejs is the most popular in this domain, so I decided to migrate from elasticlunr to fusejs. Thats why I decided to start from gatsby-plugin-elasticlunr-search, so it's API compatible.

There is another open source project here: https://www.npmjs.com/package/@draftbox-co/gatsby-plugin-fusejs, but that is removed from github and uninstallable through npm.

This plugin enables search integration via fusejs. Content is indexed and then made available via graphql to rehydrate into a fusejs index. From there, queries can be made against this index to retrieve pages

# Getting Started (TBD)

Install the plugin via `npm install @ssfbank/gatsby-plugin-search-fusejs fusejs`.

Next, update your `gatsby-config.js` file to utilize the plugin.

## Setup in `gatsby-config`

`gatsby-config.js`

```javascript
module.exports = {
  plugins: [
    {
      resolve: `@ssfbank/gatsby-plugin-search-fusej`,
      options: {
        // Fields to index
        fields: [`title`, `tags`],
        // How to resolve each field`s value for a supported node type
        resolvers: {
          // For any node of type MarkdownRemark, list how to resolve the fields` values
          MarkdownRemark: {
            title: node => node.frontmatter.title,
            tags: node => node.frontmatter.tags,
            path: node => node.frontmatter.path,
          },
        },
        // pass on fuse specific constructor options: https://fusejs.io/api/options.html
        fuseOptions: {
          isCaseSensitive: false,
        },
        // Optional filter to limit indexed nodes
        filter: (node, getNode) => node.frontmatter.tags !== "exempt",
      },
    },
  ],
}
```

## Consuming in Your Site

The serialized search index will be available via graphql. Once queried, a component can create a new index with the value retrieved from the graphql query. Search queries can be made against the hydrated search index. The results is an array of document IDs. The index can return the full document given a document ID.

In gatsby-v2, it is possible to use graphql queries inside components using [`StaticQuery`](https://www.gatsbyjs.org/docs/static-query/).

Suppose that you want to include the `Search` component inside an `Header` component. _(Of course, you could also query `siteSearchIndex` from `layout.js` component, and pass it down as prop to any component that need it.)_

First, query the data with `StaticQuery` inside the `Header` component, and pass it as props to the `Search` component.

`components/header.js`

```javascript
import React from "react"
import { StaticQuery, graphql } from "gatsby"

import Search from "./search"

const Header = () => (
  <StaticQuery
    query={graphql`
      query SearchIndexQuery {
        siteSearchIndex {
          index
        }
      }
    `}
    render={data => (
      <header>
        ... header stuff...
        <Search searchIndex={data.siteSearchIndex.index} />
      </header>
    )}
  />
)

export default Header
```

And then use the `searchIndex` inside your `Search` component.

`components/search.js`

```javascript
import React, { Component } from "react"
import { Index } from "elasticlunr"
import { Link } from "gatsby"

// Search component
export default class Search extends Component {
  constructor(props) {
    super(props)
    this.state = {
      query: ``,
      results: [],
    }
  }

  render() {
    return (
      <div>
        <input type="text" value={this.state.query} onChange={this.search} />
        <ul>
          {this.state.results.map(page => (
            <li key={page.id}>
              <Link to={"/" + page.path}>{page.title}</Link>
              {": " + page.tags.join(`,`)}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  getOrCreateIndex = () =>
    this.index
      ? this.index
      : // Create an elastic lunr index and hydrate with graphql query results
        Index.load(this.props.searchIndex)

  search = evt => {
    const query = evt.target.value
    this.index = this.getOrCreateIndex()
    this.setState({
      query,
      // Query the index with search string to get an [] of IDs
      results: this.index
        .search(query, {})
        // Map over each ID and return the full document
        .map(({ ref }) => this.index.documentStore.getDoc(ref)),
    })
  }
}
```

## Partial Searches

If you want your search to include partial matches, for example if you had the following data:

```javascript
sku: ["ab21345", "ab98765", "abcdef12"]
```

And wanted a search for "**_ab_**" to return all of those data, then you can simply include `{ expand: true }` as the second parameter to `this.index.search()` when setting the `results` state.

Taking the above example implementation, adapt the `search` function in the `Search` component to the following:

```javascript
search = evt => {
  const query = evt.target.value
  this.index = this.getOrCreateIndex()
  this.setState({
    query,
    // Query the index with search string to get an [] of IDs
    results: this.index
      .search(query, { expand: true }) // Accept partial matches
      // Map over each ID and return the full document
      .map(({ ref }) => this.index.documentStore.getDoc(ref)),
  })
}
```

## Optimize handling of data models with nested nodes

There are times when you have a data model that has nested nodes. Example resolver configuration in `gatsby-config.js`:

```
resolvers : {
  // For any node of BlogPost, list how to resolve the fields' values
  BlogPost : {
    title         : node => node.title,
    featuredImage : node => node.featuredImage___NODE // featuredImage is of type Asset below and is an id reference to Asset
  },

  // For any node of type Asset, this is how BlogPost featuredImage is resolved
  Asset : {
    fileUrl : node => node.file && node.file.url
  }
}
```

The problem with the above resolvers configuration is that it will include all Asset models in the index,
potentially bloating the index and leading to large bundle sizes and slower page load times.

The solution is to make use of the second paramater passed to each field resolver function called `getNode`. `getNode` is the same function provided by gatsby
to the [setFieldsOnGraphQLNodeType](https://www.gatsbyjs.org/docs/node-apis/#setFieldsOnGraphQLNodeType) node api method and when called
with a data model node id it will return a node with all it's data. The above example of the `BlogPost` model with the nested `featuredImage` property of
type `Asset` then becomes:

```
resolvers : {
  // For any node of BlogPost, list how to resolve the fields' values
  BlogPost : {
    title         : node => node.title,
    featuredImage : (node, getNode) => getNode(node.featuredImage___NODE) // featuredImage is of type Asset and is now the Asset model itself
  }
}
```

Now you can use the `featuredImage` data of `BlogPost` model without including all `Asset` models in the index.

You can now also resolve the gatsby store with `getNodesByType` and `getNodes`
so the full signature of node resolving is this:

```
(node, getNode, getNodesByType, getNodes)
```

Documentation of all node helpers:

- [getNode](https://www.gatsbyjs.org/docs/node-api-helpers/#getNode)
- [getNodesByType](https://www.gatsbyjs.org/docs/node-api-helpers/#getNodesByType)
- [getNodes](https://www.gatsbyjs.org/docs/node-api-helpers/#getNodes)
