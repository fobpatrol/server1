'use strict';
const _           = require('lodash');
const ParseObject = Parse.Object.extend('ChatChannel');
const ChatMessage = Parse.Object.extend('ChatMessage');
const User        = require('./User');
const MasterKey   = {useMasterKey: true};

module.exports = {
    get              : get,
    getChatChannel   : getChatChannel,
    createChatChannel: createChatChannel,
};


function get(channel) {
    return new Parse.Query(ParseObject).get(channel);
}

function createChatChannel(req, res) {
    const user    = req.user;
    const users   = req.params.users;
    const message = req.params.message;

    if (!user) {
        return res.error('Not Authorized');
    }

    if (!users) {
        return res.error('Not users');
    }

    new Parse.Promise.when(users.map(user => User.get(user))).then(_users => {

        // Define new Parse Object in memory
        let channel  = new ParseObject();
        // Define relattion in Parse Object
        let relation = channel.relation('users');
        // Add Actual user
        _users.push(user);
        // Map Users for relation
        _users.map(user => relation.add(user));
        // Create and save new Channel
        return channel.save().then(res.success).catch(res.error);

    }).catch(res.error);


}


function getChatChannel(req, res) {
    console.log('get channel');
    const user = req.user;

    console.log('user', user);

    new Parse.Query(ParseObject)
        .containedIn('users', [user])
        .find(MasterKey)
        .then(_data => {

            let _result = [];

            if (!_data || _data.length < 1) {
                res.success(_result);
            }

            let cb = _.after(_data.length, () => {
                res.success(_result);
            });

            _.each(_data, _channel => {
                let obj = {
                    id       : _channel.id,
                    createdAt: _channel.createdAt,
                    updatedAt: _channel.updatedAt,
                    profiles : [],
                    users    : [],
                    message  : null,
                    obj      : _channel
                };
                console.log('obj', obj);

                _channel.relation('users').query().find(MasterKey).then(_users => {
                    obj.users = _.filter(_users, _user => user.id != _user.id);

                    let promises = _.map(obj.users, user => new Parse.Query('UserData').equalTo('user', user)
                                                                                       .first(MasterKey));

                    new Parse.Promise.when(promises).then(profiles => {
                        obj.profiles = profiles;


                        new Parse.Query(ChatMessage)
                            .descending('createdAt')
                            .equalTo('channel', _channel)
                            .include('user')
                            .first(MasterKey)
                            .then(message => {
                                if (message) {
                                    obj.message = message;
                                }
                                console.log('obj -- final', obj);
                                _result.push(obj);
                                cb();
                            }, error => {
                                console.log('not message', error);
                                _result.push(obj);
                                cb();
                            });

                    }, res.error);

                }, res.error);

            });

        }, res.error);
}