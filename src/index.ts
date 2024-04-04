import axios from "axios";
import CryptoJs = require("crypto-js");
import qs = require("qs");
import bigInt = require("big-integer");
import dayjs = require("dayjs");
import cheerio = require("cheerio");

const headers = {
    authority: "music.163.com",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.135 Safari/537.36",
    "content-type": "application/x-www-form-urlencoded",
    accept: "*/*",
    origin: "https://music.163.com",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    referer: "https://music.163.com/api/djradio/v2/get",
    "accept-language": "zh-CN,zh;q=0.9",
};
function a() {
    var d,
        e,
        b = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        c = "";
    for (d = 0; 16 > d; d += 1) (e = Math.random() * b.length), (e = Math.floor(e)), (c += b.charAt(e));
    return c;
}

function b(a, b) {
    var c = CryptoJs.enc.Utf8.parse(b),
        d = CryptoJs.enc.Utf8.parse("0102030405060708"),
        e = CryptoJs.enc.Utf8.parse(a),
        f = CryptoJs.AES.encrypt(e, c, {
            iv: d,
            mode: CryptoJs.mode.CBC,
        });
    return f.toString();
}

function c(text) {
    text = text.split("").reverse().join("");
    const d = "010001";
    const e =
        "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
    const hexText = text
        .split("")
        .map((_) => _.charCodeAt(0).toString(16))
        .join("");
    const res = bigInt(hexText, 16).modPow(bigInt(d, 16), bigInt(e, 16)).toString(16);

    return Array(256 - res.length)
        .fill("0")
        .join("")
        .concat(res);
}

function getParamsAndEnc(text) {
    const first = b(text, "0CoJUm6Qyw8W8jud");
    const rand = a();
    const params = b(first, rand);

    const encSecKey = c(rand);
    return {
        params,
        encSecKey,
    };
}

function formatMusicItem(_) {
    return {
        id: _.mainSong.id,
        artwork: _.coverUrl,
        title: _.mainSong.name,
        artist: _.mainSong.artists[0].name,
        album: _.radio.name,
        url: `https://music.163.com/song/media/outer/url?id=${_.mainSong.id}.mp3`,
        qualities: {
            standard: {
                size: (_.mainSong.lMusic || {})?.size,
            },
        },
        copyrightId: _?.copyrightId,
    };
}
function formatAlbumItem(_) {
    return {
        id: _.id,
        artist: _.dj.nickname,
        title: _.name,
        artwork: _.picUrl,
        description: _.desc,
        date: dayjs.unix(_.createTime / 1000).format("YYYY-MM-DD"),
    };
}

function musicCanPlayFilter(_) {
    return _.feeScope === 0 || _.feeScope === 8;
}

const pageSize = 30;

async function searchBase(query, page, type) {
    const data = {
        s: query,
        limit: pageSize,
        type: type, //1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频, 1018:综合, 2000:声音
        offset: (page - 1) * pageSize,
        csrf_token: "",
    };
    const pae = getParamsAndEnc(JSON.stringify(data));
    const paeData = qs.stringify(pae);
    const res = (
        await axios({
            method: "post",
            url: "https://music.163.com/weapi/search/get",
            headers,
            data: paeData,
        })
    ).data;
    return res;
}

async function searchUserRadio(uid: number) {
    const data = {
        userId: uid,
        csrf_token: "",
    };
    const pae = getParamsAndEnc(JSON.stringify(data));
    const paeData = qs.stringify(pae);
    const res = (
        await axios({
            method: "post",
            url: "https://music.163.com/weapi/djradio/get/byuser",
            headers,
            data: paeData,
        })
    ).data;
    return res;
}

async function searchAlbum(query, page) {
    const res = await searchBase(query, page, 1009);
    const albums = res.result.djRadios.map(formatAlbumItem);
    return {
        isEnd: res.result.albumCount <= page * pageSize,
        data: albums,
    };
}

async function searchArtist(query, page) {
    const res = await searchBase(query, page, 1002);
    const artists = [];
    const userprofiles = res.result.userprofiles;
    for (let i = 0; i < userprofiles.length; i++) {
        const _ = userprofiles[i];
        const albumSize = await searchUserRadio(_.userId);
        artists.push({
            name: _.nickname,
            id: _.userId,
            avatar: _.avatarUrl,
            worksNum: albumSize.count,
        });
    }

    return {
        isEnd: res.result.artistCount <= page * pageSize,
        data: artists,
    };
}

async function getArtistWorks(artistItem, page, type) {
    if (type === "music") {
        return {
            isEnd: true,
            data: [],
        };
    } else if (type === "album") {
        const res = await searchUserRadio(artistItem.id);
        return {
            isEnd: true,
            data: res.djRadios.map(formatAlbumItem),
        };
    }
}

async function getLyric(musicItem) {
    const data = { id: musicItem.id, csrf_token: "" };
    const pae = getParamsAndEnc(JSON.stringify(data));
    const paeData = qs.stringify(pae);
    const result = (
        await axios({
            method: "post",
            url: `https://music.163.com/api/dj/program/detail`,
            headers,
            data: paeData,
        })
    ).data;
    return {
        rawLrc: result.program.description,
        translation: null,
    };
}

async function getAlbumInfo(albumItem) {
    const data = {
        radioId: albumItem.id,
        csrf_token: "",
        limit: pageSize,
    };
    const pae = getParamsAndEnc(JSON.stringify(data));
    const paeData = qs.stringify(pae);
    const res = (
        await axios({
            method: "post",
            url: `https://music.163.com/weapi/dj/program/byradio`,
            headers,
            data: paeData,
        })
    ).data;
    return {
        musicList: (res.programs || []).filter(musicCanPlayFilter).map(formatMusicItem),
    };
}

async function getMediaSource(musicItem: IMusic.IMusicItem, quality: IMusic.IQualityKey) {
    if (quality !== "standard") {
        return;
    }
    return {
        url: `https://music.163.com/song/media/outer/url?id=${musicItem.id}.mp3`,
    };
}

module.exports = {
    platform: "网易云电台",
    author: "咕咕mur",
    version: "0.0.1",
    srcUrl: "https://fastly.jsdelivr.net/gh/GuGuMur/MusicFreePlugin-NeteaseRadio@master/dist/plugin.js",
    cacheControl: "no-store",
    supportedSearchType: ["album", "artist"],
    async search(query, page, type) {
        if (type === "album") {
            return await searchAlbum(query, page);
        }
        if (type === "artist") {
            return await searchArtist(query, page);
        }
    },
    getLyric,
    getMediaSource,
    getAlbumInfo,
    getArtistWorks,
};
