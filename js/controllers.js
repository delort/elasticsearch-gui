'use strict';

/* Controllers */
function DashboardCtrl($scope, $http, elastic) {
    $http.get('/_cluster/health').success(function (data) {
        $scope.health = data;
    });
    $http.get('/_nodes').success(function (data) {
        $scope.nodes = data.nodes;
    });

    elastic.indexesDetails(function (data) {
        $scope.indices = data;
    });
}
DashboardCtrl.$inject = ['$scope', '$http', 'elastic'];

function NodeInfoCtrl($scope, $http, $routeParams) {
    var nodeId = $routeParams.nodeId;
    $http.get('/_nodes/' + nodeId + '?all=true').success(function (data) {
        $scope.nodes = data.nodes[$routeParams.nodeId];
    });
}

function HomeCtrl($scope, elastic, configuration, ejsResource, serverConfig, facetBuilder, $dialog, queryStorage) {
    $scope.isCollapsed = true;
    $scope.configure = configuration;
    $scope.fields = [];
    $scope.clusterName = "";
    $scope.search = {};
    $scope.search.advanced = {};
    $scope.search.advanced.searchFields = [];
    $scope.search.facets = [];
    $scope.search.selectedFacets = [];

    $scope.configError = "";

    $scope.results = [];
    $scope.facets = [];

    var ejs = ejsResource(serverConfig.host);

    $scope.init = function () {
        elastic.fields(function (data) {
            $scope.fields = data;
            if (!$scope.configure.title) {
                if ($scope.fields.title) {
                    $scope.configure.title = "title";
                }
            }

            if (!$scope.configure.description && $scope.fields.description) {
                $scope.configure.title = "description";
            }
        });
        elastic.clusterName(function (data) {
            $scope.clusterName = data;
        });
    };

    $scope.doSearch = function () {
        if ((!($scope.configure.title)) || (!($scope.configure.description))) {
            $scope.configError = "Please configure the title and description in the configuration at the top of the page.";
        } else {
            $scope.configError = "";
        }
        var request = ejs.Request();

        var queryFields = [];
        queryFields.push($scope.configure.title);
        queryFields.push($scope.configure.description);
        request.fields(queryFields);

        var executedQuery = searchPart();
        executedQuery = filterChosenFacetPart(executedQuery);

        request.query(executedQuery);

        facetBuilder.build($scope.search.facets, ejs, request);

        request.doSearch(function (results) {
            $scope.results = results.hits;
            $scope.facets = results.facets;
        });
    };

    $scope.addSearchField = function () {
        var searchField = {};
        searchField.field = $scope.search.advanced.newField;
        searchField.text = $scope.search.advanced.newText;
        $scope.search.advanced.searchFields.push(searchField);
    };

    $scope.removeSearchField = function (searchField) {
        var i = $scope.search.advanced.searchFields.indexOf(searchField);
        if (i > -1) {
            $scope.search.advanced.searchFields.splice(i, 1);
        }
    };

    $scope.openDialog = function () {
        var opts = {
            backdrop: true,
            keyboard: true,
            backdropClick: true,
            templateUrl: 'template/dialog/facet.html',
            controller: 'FacetDialogCtrl',
            resolve: {fields: function () {
                return angular.copy($scope.fields)
            } }};
        var d = $dialog.dialog(opts);
        d.open().then(function (result) {
            if (result) {
                $scope.search.facets.push(result);
            }
        });
    };

    $scope.removeFacetField = function (data) {
        var found = -1;
        for (var i = 0; i < $scope.search.facets.length; i++) {
            var currentFacet = $scope.search.facets[i];
            if (currentFacet.field === data) {
                found = i;
                break;
            }
        }
        if (found > -1) {
            $scope.search.facets.splice(found, 1);
        }
    };

    $scope.saveQuery = function () {
        queryStorage.saveSearch(angular.copy($scope.search));
    };

    $scope.loadQuery = function () {
        queryStorage.loadSearch(function (data) {
            $scope.search = angular.copy(data);
        });
    };

    $scope.addFilter = function (key, value) {
        if (!$scope.search.selectedFacets) {
            $scope.search.selectedFacets = [];
        }
        $scope.search.selectedFacets.push({"key": key, "value": value});
        $scope.doSearch();
    };

    $scope.checkSelectedFacet = function (key, value) {
        if (!$scope.search.selectedFacets) {
            return false;
        }
        for (var i = 0; i < $scope.search.selectedFacets.length; i++) {
            var selectedFacet = $scope.search.selectedFacets;
            if (selectedFacet[i].key === key && selectedFacet[i].value === value) {
                return true;
            }
        }
        return false;
    };

    $scope.removeFilter = function (key, value) {
        if (!$scope.search.selectedFacets) {
            return;
        }
        for (var i = 0; i < $scope.search.selectedFacets.length; i++) {
            var selectedFacet = $scope.search.selectedFacets;
            if (selectedFacet[i].key === key && selectedFacet[i].value === value) {
                $scope.search.selectedFacets.splice(i, 1);
            }
        }
        $scope.doSearch();
    };

    function searchPart() {
        var executedQuery;
        if ($scope.search.doAdvanced && $scope.search.advanced.searchFields.length > 0) {
            var tree = {};
            for (var i = 0; i < $scope.search.advanced.searchFields.length; i++) {
                var searchField = $scope.search.advanced.searchFields[i];
                var fieldForSearch = $scope.fields[searchField.field];
                recurseTree(tree, searchField.field, searchField.text);
                if (fieldForSearch.nestedPath) {
                    defineNestedPathInTree(tree, fieldForSearch.nestedPath, fieldForSearch.nestedPath);
                }
                console.log(tree);
            }
            executedQuery = constructQuery(tree);

        } else if ($scope.search.simple && $scope.search.simple.length > 0) {
            executedQuery = ejs.MatchQuery("_all", $scope.search.simple);
        } else {
            executedQuery = ejs.MatchAllQuery();
        }

        console.log(executedQuery.toString());
        return executedQuery;
    }

    function constructQuery(tree) {
        var props = Object.getOwnPropertyNames(tree);
        var theQuery = ejs.BoolQuery();
        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            if (tree[prop] instanceof Object) {
                theQuery.must(constructQuery(tree[prop]));
            } else if (!(prop.substring(0, 1) === "_")) {
                var fieldName = prop;
                if (tree._nested) {
                    fieldName = tree._nested + "." + fieldName;
                }
                theQuery.must(ejs.MatchQuery(fieldName, tree[prop]));
            }
        }

        var returnQuery;
        if (tree._nested) {
            returnQuery = ejs.NestedQuery(tree._nested);
            returnQuery.query(theQuery);
        } else {
            returnQuery = theQuery;
        }

        return returnQuery;
    }

    function defineNestedPathInTree(tree, path, nestedPath) {
        var pathItems = path.split(".");
        if (pathItems.length > 1) {
            defineNestedPathInTree(tree[pathItems[0]], pathItems.splice(1).join("."), nestedPath);
        } else {
            tree[path]._nested = nestedPath;
        }

    }

    function recurseTree(tree, newKey, value) {
        var newKeys = newKey.split(".");

        if (newKeys.length > 1) {
            if (!tree.hasOwnProperty(newKeys[0])) {
                tree[newKeys[0]] = {};
            }
            recurseTree(tree[newKeys[0]], newKeys.splice(1).join("."), value);
        } else {
            if (!tree.hasOwnProperty(newKey)) {
                tree[newKey] = value;
            }
        }
    }


    function filterChosenFacetPart(executedQuery) {
        var changedQuery = executedQuery;

        if ($scope.search.selectedFacets && $scope.search.selectedFacets.length > 0) {
            var selectedFacets = $scope.search.selectedFacets;
            var filters = [];
            for (var i = 0; i < selectedFacets.length; i++) {
                var facet = determineFacet(selectedFacets[i].key);
                var facetType = facet.facetType;
                if (facetType === "term") {
                    filters.push(ejs.TermsFilter(selectedFacets[i].key, selectedFacets[i].value));
                } else if (facetType === "datehistogram") {
                    // TODO jettro, what are we going to do here ??
                } else if (facetType === "histogram") {
                    var rangeFilter = ejs.RangeFilter(selectedFacets[i].key);
                    rangeFilter.from(selectedFacets[i].value);
                    rangeFilter.to(selectedFacets[i].value + facet.interval);
                    filters.push(rangeFilter);
                }
            }
            var andFilter = ejs.AndFilter(filters);

            changedQuery = ejs.FilteredQuery(executedQuery, andFilter);
        }
        return changedQuery;
    }

    function determineFacet(key) {
        for (var i = 0; i < $scope.search.facets.length; i++) {
            var currentFacet = $scope.search.facets[i];
            if (currentFacet.field === key) {
                return currentFacet;
            }
        }
    }

    $scope.obtainFacetByKey = function (key) {
        for (var i = 0; i < $scope.search.facets.length; i++) {
            var currentFacet = $scope.search.facets[i];
            if (currentFacet.field === key) {
                return currentFacet;
            }
        }
        return null;
    }
}
HomeCtrl.$inject = ['$scope', 'elastic', 'configuration', 'ejsResource', 'serverConfig', 'facetBuilder', '$dialog', 'queryStorage'];

function StatsCtrl() {

}

function GraphCtrl($scope, $dialog, ejsResource, elastic, serverConfig) {
    $scope.indices = [];
    $scope.types = [];
    $scope.fields = [];
    $scope.results = [];

    var ejs = ejsResource(serverConfig.host);

    /* Functions to retrieve values used to created the query */
    $scope.loadIndices = function () {
        elastic.indexes(function (data) {
            $scope.indices = data;
        });
    };

    $scope.loadTypes = function () {
        elastic.types(function (data) {
            $scope.types = data;
        });
    };

    $scope.loadFields = function () {
        elastic.fields(function (data) {
            $scope.fields = data;
        });
    };

    $scope.openDialog = function () {
        var opts = {
            backdrop: true,
            keyboard: true,
            backdropClick: true,
            templateUrl: 'template/dialog/facet.html',
            controller: 'FacetDialogCtrl',
            resolve: {fields: function () {
                return angular.copy($scope.fields)
            } }};
        var d = $dialog.dialog(opts);
        d.open().then(function (result) {
            if (result) {
                $scope.facet = result;
            }
        });
    };

    function getValue(data) {
        for (var key in data) {
            if (data.hasOwnProperty(key)) {
                return data[key];
            }
        }
    }

    $scope.executeQuery = function () {
        var request = createQuery();
        request.doSearch(function (results) {
            $scope.results = getValue(results.facets);
        });

    };

    function createQuery() {
        var request = ejs.Request();
        request.query(ejs.MatchAllQuery());
        request.size(0);

        var facet = $scope.facet;
        if (facet.facetType === 'term') {
            var termsFacet = ejs.TermsFacet(facet.field);
            termsFacet.field(facet.field);
            request.facet(termsFacet);
        } else if (facet.facetType === 'range') {
            var rangeFacet = ejs.RangeFacet(facet.field);
            for (var j = 0; j < facet.ranges.length; j++) {
                var range = facet.ranges[j];
                if (range[0] == undefined) {
                    rangeFacet.addUnboundedTo(range[1]);
                } else if (range[1] == undefined) {
                    rangeFacet.addUnboundedFrom(range[0]);
                } else {
                    rangeFacet.addRange(range[0], range[1]);
                }
            }
            rangeFacet.field(facet.field);
            request.facet(rangeFacet);
        } else if (facet.facetType === 'datehistogram') {
            var dateHistogramFacet = ejs.DateHistogramFacet(facet.field + 'Facet');
            dateHistogramFacet.field(facet.field);
            dateHistogramFacet.interval(facet.interval);
            request.facet(dateHistogramFacet);
        } else if (facet.facetType === 'histogram') {
            var histogramFacet = ejs.HistogramFacet(facet.field + 'Facet');
            histogramFacet.field(facet.field);
            histogramFacet.interval(facet.interval);
            request.facet(histogramFacet);
        }
        return request;
    }


    $scope.loadIndices();
    $scope.loadTypes();
    $scope.loadFields();
}
GraphCtrl.$inject = ['$scope', '$dialog', 'ejsResource', 'elastic', 'serverConfig']

function QueryCtrl($scope, $dialog, ejsResource, elastic, serverConfig, facetBuilder, queryStorage) {
    $scope.fields = [];
    $scope.createdQuery = "";

    $scope.queryResults = [];
    $scope.facetResults = [];
    $scope.queryFactory = {};
    $scope.query = {};

    $scope.query.chosenFields = [];
    $scope.query.facets = [];
    $scope.query.indices = {};
    $scope.query.types = {};

    var ejs = ejsResource(serverConfig.host);

    /* Functions to retrieve values used to created the query */
    $scope.loadIndices = function () {
        elastic.indexes(function (data) {
            if (data) {
                for (var i = 0; i < data.length; i++) {
                    $scope.query.indices[data[i]] = {"name": data[i], "state": false};
                }
            } else {
                $scope.query.indices = {};
            }
        });
    };

    $scope.loadTypes = function () {
        elastic.types(function (data) {
            if (data) {
                for (var i = 0; i < data.length; i++) {
                    $scope.query.types[data[i]] = {"name": data[i], "state": false};
                }
            } else {
                $scope.query.types = {};
            }
        });
    };

    $scope.loadFields = function () {
        elastic.fields(function (data) {
            $scope.fields = data;
        });
    };

    /* Function to change the input for the query to be executed */
    $scope.addQueryField = function () {
        var i = $scope.query.chosenFields.indexOf($scope.queryFactory.addField);
        if (i == -1) {
            $scope.query.chosenFields.push($scope.queryFactory.addField);
        }
        $scope.changeQuery();
    };

    $scope.removeQueryField = function (data) {
        var i = $scope.query.chosenFields.indexOf(data);
        if (i > -1) {
            $scope.query.chosenFields.splice(i, 1);
        }
        $scope.changeQuery();
    };

    $scope.removeFacetField = function (data) {
        var found = -1;
        for (var i = 0; i < $scope.query.facets.length; i++) {
            var currentFacet = $scope.query.facets[i];
            if (currentFacet.field === data) {
                found = i;
                break;
            }
        }
        if (found > -1) {
            $scope.query.facets.splice(found, 1);
        }
        $scope.changeQuery();
    };

    /* Functions to create, reset and execute the query */
    $scope.executeQuery = function () {
        $scope.changeQuery();
        var request = createQuery();
        request.doSearch(function (results) {
            $scope.queryResults = results.hits;
            $scope.facetResults = results.facets;
        });

    };

    $scope.resetQuery = function () {
        $scope.loadIndices();
        $scope.loadTypes();
        $scope.loadFields();
        $scope.query.term = "";
        $scope.query.chosenIndices = [];
        $scope.query.chosenTypes = [];
        $scope.query.chosenFields = [];
        $scope.changeQuery();
        $scope.query.type = "or";
    };

    $scope.changeQuery = function () {
        $scope.createdQuery = createQuery().toString();
    };

    $scope.openDialog = function () {
        var opts = {
            backdrop: true,
            keyboard: true,
            backdropClick: true,
            templateUrl: 'template/dialog/facet.html',
            controller: 'FacetDialogCtrl',
            resolve: {fields: function () {
                return angular.copy($scope.fields)
            } }};
        var d = $dialog.dialog(opts);
        d.open().then(function (result) {
            if (result) {
                $scope.query.facets.push(result);
                $scope.changeQuery();
            }
        });
    };

    $scope.saveQuery = function () {
        queryStorage.saveQuery(angular.copy($scope.query));
        console.log($scope.query);
    };

    $scope.loadQuery = function () {
        queryStorage.loadQuery(function (data) {
            $scope.query = angular.copy(data);
            $scope.changeQuery();
            console.log($scope.query);
        });
    };


    function createQuery() {
        var request = ejs.Request();
        var chosenIndices = [];
        angular.forEach($scope.query.indices, function (value) {
            if (value.state) {
                chosenIndices.push(value.name);
            }
        });
        request.indices(chosenIndices);
        var chosenTypes = [];
        angular.forEach($scope.query.types, function (value) {
            if (value.state) {
                chosenTypes.push(value.name);
            }
        });
        request.types(chosenTypes);
        if ($scope.query.chosenFields.length > 0) {
            request.fields($scope.query.chosenFields);
        }
        if ($scope.query.term.length > 0) {
            var matchQuery = ejs.MatchQuery("_all", $scope.query.term);
            if ($scope.query.type === 'phrase') {
                matchQuery.type('phrase');
            } else {
                matchQuery.operator($scope.query.type);
            }
            request.query(matchQuery);
        } else {
            request.query(ejs.MatchAllQuery());
        }

        facetBuilder.build($scope.query.facets, ejs, request);

        request.explain($scope.query.explain);
        if ($scope.query.highlight) {
            var highlight = ejs.Highlight();
            highlight.fields($scope.query.chosenFields);
            request.highlight(highlight);
        }
        return request;
    }

    function toggleChoice(theArray, theChoice) {
        var i = theArray.indexOf(theChoice);
        if (i > -1) {
            theArray.splice(i, 1);
        } else {
            theArray.push(theChoice);
        }
    }

    $scope.resetQuery();
}
QueryCtrl.$inject = ['$scope', '$dialog', 'ejsResource', 'elastic', 'serverConfig', 'facetBuilder', 'queryStorage'];

function NavbarCtrl($scope, $timeout, elastic) {
    $scope.statusCluster = {};

    var items = $scope.items = [
        {title: 'Home', link: 'home'},
        {title: 'Dashboard', link: 'dashboard'},
        {title: 'Queries', link: 'query'},
        {title: 'Graphs', link: 'graph'},
        {title: 'Statistics', link: 'stats'},
        {title: 'About', link: 'about'}
    ];

    this.select = $scope.select = function (item) {
        angular.forEach(items, function (item) {
            item.selected = false;
        });
        item.selected = true;
    };

    this.selectByUrl = function (url) {
        angular.forEach(items, function (item) {
            if ('/' + item.link === url) {
                $scope.select(item);
            }
        });
    };

    $timeout(function checkCluster() {
        elastic.clusterStatus(function (message, status) {
            $scope.statusCluster.message = message;
            $scope.statusCluster.state = status;
        });
        $timeout(checkCluster, 5000);
    }, 1000);
}
NavbarCtrl.$inject = ['$scope', '$timeout', 'elastic'];

function FacetDialogCtrl($scope, dialog, fields) {
    $scope.fields = fields;
    $scope.facetTypes = ["Term", "Range", "Histogram", "DateHistogram"];
    $scope.ranges = [];
    $scope.intervals = ["year", "month", "week", "day", "hour", "minute"];
    $scope.interval = "";

    $scope.close = function (result) {
        var dialogResult = {};
        dialogResult.field = $scope.dialog.field;
        if ($scope.dialog.facettype === 'Term') {
            dialogResult.facetType = 'term';
        } else if ($scope.dialog.facettype === 'Range') {
            dialogResult.facetType = 'range';
            dialogResult.ranges = $scope.ranges;
        } else if ($scope.dialog.facettype === 'DateHistogram') {
            dialogResult.facetType = 'datehistogram';
            dialogResult.interval = $scope.interval;
        } else if ($scope.dialog.facettype === 'Histogram') {
            dialogResult.facetType = 'histogram';
            dialogResult.interval = $scope.interval;
        }
        dialog.close(dialogResult);
    };

    $scope.addRangeField = function () {
        $scope.ranges.push([$scope.dialog.range.from, $scope.dialog.range.to]);
    }
}