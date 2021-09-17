# FUSEJS Search Plugin for Gatsby

This is a fork of [gatsby-plugin-elasticlunr-search](https://github.com/andrew-codes/gatsby-plugin-elasticlunr-search) made in order to use Fusejs in gatsby.

elasticlunr is unmaintained, and fusejs is the most popular in this domain, so I decided to migrate from elasticlunr to fusejs. Thats why I decided to start from gatsby-plugin-elasticlunr-search, so it's almost API compatible.

There is another open source project here: https://www.npmjs.com/package/@draftbox-co/gatsby-plugin-fusejs, but that is removed from github and uninstallable through npm.

This plugin enables search integration via fusejs. Content is indexed and then made available via graphql to rehydrate into a fusejs index. From there, queries can be made against this index to retrieve pages

# Getting Started

Install the plugin via `npm install @ssfbank/gatsby-plugin-search-fusejs fuse.js`.

Next, update your `gatsby-config.js` file to utilize the plugin.

## Setup in `gatsby-config`

`gatsby-config.js`

```javascript
module.exports = {
  plugins: [
    {
      resolve: `@ssfbank/gatsby-plugin-search-fusejs`,
      options: {
        // How to resolve each field`s value for a supported node type
        resolvers: {
          // For any node of type MarkdownRemark, list how to resolve the fields` values
          MarkdownRemark: {
            title: (node) => node.frontmatter.title,
            tags: (node) => node.frontmatter.tags,
            path: (node) => node.frontmatter.path,
          },
          // Example showcasing the main use case of resolver namespacing, languages.
          // Having this hierarchical namespace-level is controlled by useResolverNamespaces
          SanityPage: {
            en: {
              title: (node) => node.frontmatter.title.en,
              tags: (node) => node.frontmatter.tags,
              path: (node) => node.frontmatter.path,
            },
            nn: {
              title: (node) => node.frontmatter.title.nb,
              tags: (node) => node.frontmatter.tags,
              path: (node) => node.frontmatter.path,
            },
            // fr: {}, de: {}, jp: {} and so on. Watch out for exponential data growth with languages
          },
        },
        // pass on fuse specific constructor options: https://fusejs.io/api/options.html
        fuseOptions: {
          keys: [`title`, `tags`], // Mandatory
          ignoreLocation: true,
          treshold: 0.4,
        },
        // if you want a copy of the serialized data structure into the public folder for external or lazy-loaded clientside consumption
        // will be put in ./public folder and will end up as ./public/fuse-search-data.json
        copySerializationToFile: 'fuse-search-data',

        // Allow separate namespaces unde reach resolver,
        // which again leads to the same namespaces in the data
        useResolverNamespaces: false,
        // Optional filter to limit indexed nodes
        filter: (node, getNode) => node.frontmatter.tags !== 'exempt',
      },
    },
  ],
};
```

## Consuming in Your Site

The serialized search index will be available via graphql. Once queried, a component can construct a fuse instance using the documents and index. This instance can then be searched against. The results is a sorted array of the documents according to search scoring.

Data structure of graphql data (or json in the case of `copySerializationToFile`

```javascript
{
  fuse: {
    documents: [
      {
        title: 'About us',
        tags: 'aboutus',
        path: '/about'
      },
      {
        title: 'Contact',
        tags: 'contact',
        path: '/contact'
      }
    ],
    index: {} // fusejs serialization of Fuse.createIndex abbreviated
  }
}
```

Example data structure when you use resolver namespacing:

```javascript
{
  fuse: {
    en: {
      documents: [
        {
          title: 'About us',
          tags: 'aboutus',
          path: '/about'
        },
        {
          title: 'Contact',
          tags: 'contact',
          path: '/contact'
        }
      ],
      index: {} // fusejs serialization of Fuse.createIndex abbreviated
    },
    nn: {
      documents: [
        {
          title: 'Kven er vi',
          tags: 'aboutus',
          path: '/about'
        },
        {
          title: 'Tyt og gnæg',
          tags: 'contact',
          path: '/contact'
        }
      ],
      index: {} // fusejs serialization of Fuse.createIndex abbreviated
    }
  }
}
```

## React gatsby

Below is an example with typescript and hooks react.

It uses gatsby page query because that's what we use, but if you use the search in several pages, you should use useStaticQuery().

Using `copySerializationToFile` it should also be able to make this lazy-loaded and chunked using clientside fetching. I have not tested this though.

For simplicity I will only inlude an example using namespacing.
If you do not use namespacing, just skip that level of the hierarchy.

I left in how query parameter searching can be done.

```typescript
type State = {
  query: string;
  results: SearchResultDocument[];
};

type SanityData = {
  fuseSearchIndex: {
    fuse: {
      nn: { index: any; documents: SearchResultDocument[] };
      en: { index: any; documents: SearchResultDocument[] };
    };
  };
};

const Search = (props: PageProps<SanityData>) => {
  const { data, location } = props;
  const { fuseSearchIndex } = data;
  const [language] = useLanguage(); // nn | en

  const fuse = useMemo(() => {
    const idx = Fuse.parseIndex<PageSearchIndex>(
      fuseSearchIndex.fuse[language].index
    );

    return new Fuse<PageSearchIndex>(
      fuseSearchIndex.fuse[language].documents,
      {
        keys: [
          {
            name: 'title',
            weight: 3,
          },
          {
            name: 'searchKeywords',
            weight: 4,
          },
        ],
        ignoreLocation: true,
        threshold: 0.4,
      },
      idx
    );
  }, [fuseSearchIndex, language]);

  const [searchState, setSearchState] = useState<State>({
    query: '',
    results: [],
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search.substring(1));
    const paramQuery = params.get('q') || '';
    if (paramQuery) {
      const paramResults = fuse.search(paramQuery).map((i) => i.item);
      setSearchState({
        query: paramQuery,
        results: paramResults,
      });
    }
  }, [location, fuse]);

  const { query, results } = searchState;

  return (
    <>
      <input
        name="searcher"
        value={query}
        placeholder={'Search....'}
        onChange={(newQuery) => {
          const newResults = fuse.search(newQuery).map((i) => i.item);

          setSearchState({
            query: newQuery,
            results: newResults,
          });
        }}
      />
      <div>
      {
        results.map(result => (<div>{result.title}</div>))
      }
      </div>
    </>
  );
};

export default Sok;

export const query = graphql`
  {
    fuseSearchIndex: siteSearchIndex {
      fuse
    }
  }
`;
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
