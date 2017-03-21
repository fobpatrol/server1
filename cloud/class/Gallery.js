'use strict';
const _               = require('lodash');
const Image           = require('./../helpers/image');
const User            = require('./../class/User');
const GalleryActivity = require('./../class/GalleryActivity');
const GalleryComment  = require('./../class/GalleryComment');
const ParseObject     = Parse.Object.extend('Gallery');
const GalleryAlbum    = Parse.Object.extend('GalleryAlbum');
const UserFollow      = Parse.Object.extend('UserFollow');
const MasterKey       = {useMasterKey: true};

module.exports = {
    beforeSave:     beforeSave,
    afterSave:      afterSave,
    afterDelete:    afterDelete,
    get:            get,
    getGallery:     getGallery,
    feed:           feed,
    search:         search,
    getAlbum:       getAlbum,
    commentGallery: commentGallery,
    isGalleryLiked: isGalleryLiked,
    likeGallery:    likeGallery,
    parseGallery:   parseGallery,
    updateGallery:  updateGallery,
    destroyGallery: destroyGallery,
    createGallery:  createGallery
};

function createGallery(req, res) {
    const user   = req.user;
    const params = req.params;

    Image.saveImage(params.image).then(image => {
        let form   = req.params;
        form.image = image;
        form.user  = user;

        if (form.address && form.address.geo) {
            form.location = new Parse.GeoPoint(form.address.geo);
        }
        new ParseObject().save(form, MasterKey).then(res.success).catch(res.error);
    });
}

function updateGallery(req, res) {
    const user   = req.user;
    const params = req.params;

    get(params.id).then(gallery => {
        let attributes = req.params;
        delete attributes.id;

        _.each(attributes, (value, key) => {
            if (value) gallery.set(key, value);
        });

        if (attributes['address'] && attributes['address']['geo']) {
            gallery.set('location', new Parse.GeoPoint(params.address['geo']));
        }
        gallery.save().then(res.success).catch(res.error);
    });
}

function countGalleriesTotal(user) {
    return new Parse.Query('Gallery').equalTo('user', user).count(MasterKey);
}

function countAlbumTotal(album) {
    return new Parse.Query('Gallery').equalTo('album', album).count(MasterKey);
}

function countCommentsTotal(gallery) {
    return new Parse.Query('GalleryComment').equalTo('gallery', gallery).count(MasterKey);
}

function parseGallery(item) {
    let obj = {};
    if (item) {
        obj = {
            id:            item.id,
            _id:           item.id,
            title:         item.get('title'),
            address:       item.get('address'),
            album:         require('./../class/GalleryAlbum').parseGalleryAlbum(item.get('album')),
            albumId:       item.get('albumId'),
            commentsTotal: item.get('commentsTotal'),
            likesTotal:    item.get('likesTotal'),
            image:         item.get('image').url(),
            imageLow:      item.get('imageLow') ? item.get('imageLow').url() : item.get('image').url(),
            imageThumb:    item.get('imageThumb').url(),
            privacity:     item.get('privacity'),
            isLiked:       false,
            comments:      [],
            user:          {},
            createdAt:     item.createdAt,
        };
    }

    if (item.get('user')) {
        obj.user = User.parseUser(item.get('user'));
    }

    return obj;
}

function beforeSave(req, res) {
    const object = req.object;
    const user   = req.user || req.object.get('user');

    if (!user) {
        return res.error('Not Authorized');
    }

    if (!object.get('image')) {
        return res.error('Upload the first image');
    }

    if (!object.dirty('image')) {
        return res.success();
    }

    // Search Gallery
    //https://parse.com/docs/js/guide#performance-implement-efficient-searches
    let toLowerCase = w => w.toLowerCase();
    var words       = object.get('title').split(/\b/);
    words           = _.map(words, toLowerCase);
    var stopWords   = ['the', 'in', 'and'];
    words           = _.filter(words, w => w.match(/^\w+$/) && !_.includes(stopWords, w));
    var hashtags    = object.get('title').match(/#.+?\b/g);
    hashtags        = _.map(hashtags, toLowerCase);

    object.set('words', words);
    object.set('hashtags', hashtags);

    // Resize Image
    if (!object.existed()) {
        let imageUrl = object.get('image').url();

        // cover
        // progressive
        // thumb

        Parse.Promise.when([
            Image.resizeUrl(imageUrl, 640).then(image => Image.saveImage(image)),
            Image.progressive(imageUrl, 640).then(image => Image.saveImage(image)),
            Image.resizeUrl(imageUrl, 160).then(image => Image.saveImage(image)),
        ]).then(parseFile => {

            object.set('image', parseFile[0]);
            object.set('imageLow', parseFile[1]);
            object.set('imageThumb', parseFile[2]);

            object.increment('followersTotal', 0);
            object.increment('followingsTotal', 0);
            object.increment('likesTotal', 0);
            object.increment('galleriesTotal', 0);
            object.increment('commentsTotal', 0);
            object.increment('views', 0);

            new Parse.Query('UserData').equalTo('user', user).first(MasterKey).then(profile => {

                // Set default values
                object.set('user', user);
                object.set('isApproved', true);
                object.set('profile', profile);
                //gallery.setACL(new Parse.Parse.ACL(req.user));
                return res.success();
            });

        }).catch(res.error);
    } else {
        res.success();
    }
}

function afterDelete(req, res) {

    const user = req.object.get('user');

    let deleteComments = new Parse.Query('GalleryComment').equalTo('gallery', req.object).find().then(results => {
        // Collect one promise for each delete into an array.
        let promises = [];
        _.each(results, result => {
            promises.push(result.destroy());
            User.decrementComment(req.user);
        });
        // Return a new promise that is resolved when all of the deletes are finished.
        return Parse.Promise.when(promises);

    });

    let deleteActivity = new Parse.Query('GalleryActivity').equalTo('gallery', req.object).find().then(results => {
        // Collect one promise for each delete into an array.
        let promises = [];
        _.each(results, result => {
            promises.push(result.destroy());
        });
        // Return a new promise that is resolved when all of the deletes are finished.
        return Parse.Promise.when(promises);

    });

    let promises = [
        deleteActivity,
        deleteComments,
        countGalleriesTotal(user).then(galleriesTotal => User.updateGalleriesTotal(user, galleriesTotal))
    ];

    if (req.object.get('album')) {
        let decrementAlbum = new Parse.Query('GalleryAlbum').equalTo('objectId', req.object.get('album').id).first(MasterKey).then(galleryAlbum => galleryAlbum.increment('qtyPhotos', -1).save(null, MasterKey));
        promises.push(decrementAlbum);
    }

    Parse.Promise.when(promises).then(res.success).catch(res.error);

}

function afterSave(req) {
    const user    = req.object.get('user');
    const albumId = req.object.get('albumId');

    if (albumId) {
        new Parse.Query('GalleryAlbum')
            .equalTo('objectId', albumId)
            .first(MasterKey)
            .then(album => {
                req.object.set('album', album);
                req.object.save();
                // Relation Photo with Album
                let relation = album.relation('photos');
                relation.add(req.object);

                // Total Album photos
                album.set('image', req.object.get('image'));
                album.set('imageThumb', req.object.get('imageThumb'));

                countAlbumTotal(album).then(qtyPhotos => {
                    album.set('qtyPhotos', qtyPhotos);
                    album.save(MasterKey);
                });
            });
    }

    //if (!req.object.existed()) {
    // Update galleriesTotal
    countGalleriesTotal(user).then(galleriesTotal => User.updateGalleriesTotal(user, galleriesTotal));

    //}
}

function getGallery(req, res) {
    get(req.params.id)
        .then(gallery => parseGallery(gallery))
        .then(res.success)
        .catch(res.reject);
}

function get(objectId) {
    return new Parse.Query(ParseObject).equalTo('objectId', objectId).include(['user']).first(MasterKey);
}

function commentGallery(req, res) {
    const params = req.params;
    const _page  = req.params.page || 1;
    const _limit = req.params.limit || 10;

    new Parse.Query(ParseObject)
        .equalTo('objectId', params.galleryId)
        .first()
        .then(gallery => {

            new Parse.Query('GalleryComment')
                .equalTo('gallery', gallery)
                .limit(_limit)
                .skip((_page * _limit) - _limit)
                .find(MasterKey)
                .then(data => {
                    let _result = [];

                    if (!data.length) {
                        res.success(_result);
                    }

                    let cb = _.after(data.length, () => {
                        res.success(_result);
                    });

                    _.each(data, itemComment => {

                        // User Data
                        let userGet = itemComment.get('user');
                        new Parse.Query('UserData').equalTo('user', userGet).first().then(user => {

                            // If not profile create profile
                            if (!itemComment.get('profile')) {
                                itemComment.set('profile', user);
                                itemComment.save();
                            }

                            // If not profile create profile
                            if (!gallery.get('profile')) {
                                gallery.set('profile', user);
                                gallery.save();
                            }
                            let obj = GalleryComment.parseComment(itemComment);

                            _result.push(obj);
                            cb();
                        }).catch(res.error);
                    });
                }).catch(res.error);
        });
}

function search(req, res, next) {
    const params = req.params;
    const _page  = req.params.page || 1;
    const _limit = req.params.limit || 24;

    let _query = new Parse.Query(ParseObject);

    let text = params.search;

    if (text && text.length > 0) {
        let toLowerCase = w => w.toLowerCase();
        let words       = text.split(/\b/);
        words           = _.map(words, toLowerCase);

        let stopWords = ['the', 'in', 'and'];
        words         = _.filter(words, w => w.match(/^\w+$/) && !_.includes(stopWords, w));

        let hashtags = text.match(/#.+?\b/g);
        hashtags     = _.map(hashtags, toLowerCase);

        if (words) {
            _query.containsAll('words', [words]);
        }

        if (hashtags) {
            _query.containsAll('hashtags', [hashtags]);
        }

    }

    _query
        .equalTo('isApproved', true)
        .descending('createdAt')
        .limit(_limit)
        .skip((_page * _limit) - _limit)
        .find(MasterKey)
        .then(data => {
            let _result = [];

            if (!data.length) {
                res.success(_result);
            }

            let cb = _.after(data.length, () => {
                res.success(_result);
            });

            _.each(data, itemGallery => {

                // User Data
                let userGet = itemGallery.get('user');
                new Parse.Query('UserData').equalTo('user', userGet).first({
                    useMasterKey: true
                }).then(user => {

                    let obj = parseGallery(itemGallery);
                    //console.log('Obj', obj);

                    // Is Liked
                    new Parse.Query('Gallery')
                        .equalTo('likes', req.user)
                        .equalTo('objectId', itemGallery.id)
                        .first({
                            useMasterKey: true
                        })
                        .then(liked => {
                            obj.isLiked = liked ? true : false;

                            // Comments
                            new Parse.Query('GalleryComment')
                                .equalTo('gallery', itemGallery)
                                .limit(3)
                                .find({
                                    useMasterKey: true
                                })
                                .then(comments => {
                                    obj.comments = map.comments(comment => GalleryComment.parseComment(comment));
                                    //console.log('itemGallery', itemGallery, user, comments);
                                    // Comments
                                    _result.push(obj);
                                    cb();

                                }).catch(res.error);
                        }).catch(res.error);
                }).catch(res.error);
            });
        }).catch(res.error);

}

function getAlbum(req, res) {
    const params = req.params;
    const _page  = req.params.page || 1;
    const _limit = req.params.limit || 24;

    new Parse.Query(GalleryAlbum)
        .equalTo('objectId', params.id)
        .first(MasterKey)
        .then(album => {

            new Parse.Query(ParseObject)
                .descending('createdAt')
                .limit(_limit)
                .skip((_page * _limit) - _limit)
                .equalTo('album', album)
                .find(MasterKey)
                .then(photos => photos.map(parseGallery))
                .then(res.success)
                .catch(res.error);

        }).catch(res.error);
}

function feed(req, res) {
    const params = req.params;
    const _page  = req.params.page || 1;
    const _limit = req.params.limit || 24;

    let _query = new Parse.Query(ParseObject);

    if (params.filter) {
        _query.contains('words', params.filter);
    }

    if (params.hashtags) {
        _query.containsAll('hashtags', [params.hashtags]);
    }

    if (params.id) {
        _query.equalTo('objectId', params.id);
    }

    if (params.username) {
        new Parse.Query(Parse.User)
            .equalTo('username', params.username)
            .first(MasterKey)
            .then(user => {
                _query.equalTo('user', user);
                _query.containedIn('privacity', ['', null, undefined, 'public']);
                runQuery();
            }).catch(error => runQuery());
    } else {
        // Follow
        if (params.privacity === 'followers') {
            new Parse.Query(UserFollow)
                .equalTo('from', req.user)
                .include('user')
                .find(MasterKey)
                .then(users => {
                    let following = [];
                    _.map(users, userFollow => {
                        let user = userFollow.get('to');
                        if (user && !_.some(following, {id: user['id']})) {
                            following.push(user);
                        }
                    });
                    following.push(req.user);

                    _query.containedIn('user', following);
                    _query.containedIn('privacity', ['', null, undefined, 'public']);
                    runQuery();
                }).catch(res.error);
        }

        // Me
        if (params.privacity === 'me') {
            _query.containedIn('user', [req.user]);
            runQuery();
        }

        // Public
        if (!params.privacity || params.privacity === 'public') {
            _query.containedIn('privacity', ['', null, undefined, 'public']);
            runQuery();
        }

    }

    function runQuery() {

        _query
            .equalTo('isApproved', true)
            .descending('createdAt')
            .limit(_limit)
            .skip((_page * _limit) - _limit)
            .include(['user,album'])
            .find(MasterKey)
            .then(_data => {
                let _result = [];

                if (!_data || !_data.length) {
                    res.success([]);
                }

                let cb = _.after(_data.length, () => res.success(_result));

                _.each(_data, _gallery => {

                    // User Data
                    let obj = parseGallery(_gallery);

                    // Is Liked
                    new Parse.Query('Gallery')
                        .equalTo('likes', req.user)
                        .equalTo('objectId', _gallery.id)
                        .include(['user'])
                        .first(MasterKey)
                        .then(liked => {
                            obj.isLiked = liked ? true : false;

                            // Comments
                            new Parse.Query('GalleryComment')
                                .equalTo('gallery', _gallery)
                                .limit(3)
                                .include(['user'])
                                .find(MasterKey)
                                .then(_comments => {
                                    obj.comments = _comments.map(comment => GalleryComment.parseComment(comment));
                                    //console.log('itemGallery', itemGallery, user, comments);
                                    // Comments
                                    _result.push(obj);

                                    // Incremment Gallery
                                    //_gallery.increment('views');
                                    //_gallery.save();
                                    cb();

                                }, error => {
                                    // Comments
                                    _result.push(obj);

                                    // Incremment Gallery
                                    //_gallery.increment('views');
                                    //_gallery.save();
                                    cb();
                                });
                        }, res.error);
                });

            }, res.error);
    }
}

function likeGallery(req, res, next) {
    const user      = req.user;
    const galleryId = req.params.galleryId;

    if (!user) {
        return res.error('Not Authorized');
    }

    let objParse;
    let response = {action: null};

    new Parse.Query('Gallery').get(galleryId).then(gallery => {
        objParse = gallery;
        return new Parse.Query('Gallery')
            .equalTo('likes', user)
            .equalTo('objectId', galleryId)
            .find();
    }).then(result => {

        let relation = objParse.relation('likes');

        if (result && result.length > 0) {
            objParse.increment('likesTotal', -1);
            relation.remove(user);
            //response.action = 'unlike';
        } else {
            objParse.increment('likesTotal');
            relation.add(user);

        }
        return objParse.save(null, MasterKey);

    }).then(data => {
        if (user.id != objParse.attributes.user.id) {
            let activity = {
                fromUser: user,
                gallery:  objParse,
                action:   'liked your photo',
                toUser:   objParse.attributes.user
            };
            GalleryActivity.create(activity);
        }
        res.success(response);
    }).catch(res.error);
}

function isGalleryLiked(req, res, next) {
    const user      = req.user;
    const galleryId = req.params.galleryId;

    if (!user) {
        return res.error('Not Authorized');
    }

    new Parse.Query('Gallery')
        .equalTo('likes', user)
        .equalTo('objectId', galleryId)
        .first(MasterKey)
        .then(gallery => res.success(gallery ? true : false), res.error);
}

function destroyGallery(req, res) {
    new Parse.Query('Gallery').get(req.params.id).then(gallery => {
        gallery.destroy(MasterKey).then(res.success).catch(res.reject);
    }).catch(res.reject);
}