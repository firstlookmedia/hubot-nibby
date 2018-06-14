
// Description:
//   nibby
//
// Dependencies:
//   "<module name>": "<module version>"
//
// Configuration:
//   THENIB_REALM_ID - foo
//
// Commands:
//   hubot nibby - foo
//   hubot show thenib featured - bar
//
// Author:
//   @firstlookmedia

'use strict'

const request = require('request-promise-native') ;
const CronJob = require('cron').CronJob ;

const { WebClient } = require('@slack/client') ;

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').load();
}

const THENIB_ORIGIN      = process.env.THENIB_ORIGIN || 'https://thenib.com' ;
const THENIB_GRAPHQL_URL = process.env.THENIB_GRAPHQL_URL ;
const THENIB_REALM_ID    = process.env.THENIB_REALM_ID ;

const THENIB_CRON_TIMEZONE = process.env.THENIB_CRON_TIMEZONE || 'America/New_York' ;
const THENIB_CRON_PATTERN_FEATURED = process.env.THENIB_CRON_PATTERN_FEATURED || '0 11 * * 1-5' ;

const THENIB_REACTION_NAME_NIBBY = process.env.THENIB_REACTION_NAME_NIBBY || 'nibby' ;
const THENIB_REACTION_NAME_PEETAPE = process.env.THENIB_REACTION_NAME_PEETAPE || 'vhs' ;

module.exports = (robot) => {

  robot.logger.info( `robot: ${robot}` ) ;

  const is_slack = ( robot.adapterName === 'slack' ) ;

  let web ;

  if ( is_slack ) {
    web = new WebClient( robot.adapter.options.token ) ;
  }
  else {
    robot.logger.info( `disabling nibby; requires the slack adapter, adapter: ${robot.adapterName}` ) ;
    return {}
  }

  //
  robot.hear( /(^|\W)nibby(\W|$)/i, (res) => {
    robot.logger.info( `heard nibby: channel: ${res.message.rawMessage.channel.id}, name: ${THENIB_REACTION_NAME_NIBBY};` ) ;

    if ( is_slack )
    {
      web.reactions.add({
        name: THENIB_REACTION_NAME_NIBBY,
        channel: res.message.rawMessage.channel.id,
        timestamp: res.message.rawMessage.ts
      })
      .catch( err => robot.logger.error( err ) )
    }
    else
    {
      res.reply( `yup, i'm here!` )
    }
  })

  //
  robot.hear( /(^|\W)pee\s*tape(\W|$)/i, (res) => {
    robot.logger.info( `heard peetape: channel: ${res.message.rawMessage.channel.id}, name: ${THENIB_REACTION_NAME_PEETAPE};` ) ;

    if ( is_slack )
    {
      web.reactions.add({
        name: THENIB_REACTION_NAME_NIBBY,
        channel: res.message.rawMessage.channel.id,
        timestamp: res.message.rawMessage.ts
      })
      .then( () => {

        web.reactions.add({
          name: THENIB_REACTION_NAME_PEETAPE,
          channel: res.message.rawMessage.channel.id,
          timestamp: res.message.rawMessage.ts
        })

      })
      .catch( err => robot.logger.error( err ) )
    }
    else
    {
      res.send( `the peetape is real!` )
    }

  })

  //
  if ( is_slack )
  {
    robot.react( (res) => {
      if (
        res.message.type === "added" &&
        res.message.item.type === "message" &&
        res.message.reaction === THENIB_REACTION_NAME_NIBBY
      )
      {
        robot.logger.info( `matched reaction: channel: ${res.message.item.channel}, name: ${THENIB_REACTION_NAME_NIBBY}` ) ;

        web.reactions.add({
          name: THENIB_REACTION_NAME_NIBBY,
          channel: res.message.item.channel,
          timestamp: res.message.item.ts
        })
        .catch( err => robot.logger.error( err ) )
      }
    })
  }

  //
  robot.respond( /(get|show) featured/i, (res) => {

    getFeaturedComics()
      .then( results => {

        if ( results.length <= 0 ) {
          res.reply( "Sorry, there are no featured comics right now." )
          return
        }

        let msg = "" ;

        results.forEach(
          result => {
            if ( result.node.title === undefined ) { return }

            let title = result.node.title.text
            let slug = result.node.speakingId
            robot.logger.debug( `title: ${title}; slug: ${slug}` )

            msg += `${title}: ${THENIB_ORIGIN}/${slug}\n`
          }
        )

        res.reply( `Okay, here are the current featured comics on The Nib:\n${msg}` ) ;

      })
      .catch ( err => {
        res.reply( "Sorry, I had some trouble getting the featured comics. Ask someone to fix me!" ) ;
        robot.logger.error( err ) ;
      })
  })

}

let featuredCronFactory = ( room_name ) => {
  return new CronJob({
    cronTime: THENIB_CRON_PATTERN_FEATURED,
    onTick: () => {

      getFeaturedComics()
        .then( results => {

          if ( results.length <= 0 ) {
            robot.logger.info( 'cron: no featured comics found' )
            return
          }

          let msg = "" ;

          results.forEach(
            result => {
              if ( result.node.title === undefined ) { return }

              let title = result.node.title.text
              let slug = result.node.speakingId
              robot.logger.debug( `title: ${title}; slug: ${slug}` )

              msg += `${title}: ${THENIB_ORIGIN}/${slug}\n`
            }
          )

          robot.messageRoom(
            room_name,
            `Hello! As requested, here are the current featured comics on The Nib:\n${msg}`
          )

        })
        .catch( err => {
          robot.logger.error( 'cron: error while fetching featured comics' )
        })
    },
    start: false,
    timeZone: THENIB_CRON_TIMEZONE
  })
}
// featuredCronFactory( 'x-bot-testing' ).start() ;

let getFeaturedComics = () => {

  const requestString = `{
    viewer {
      realmContent( id: "${THENIB_REALM_ID}" ) {
        listSpeaking (id: "featured") {
          members {
            edges {
              node {
                id
                ...on Comic {
                  title (format: plain) {
                    text
                  },
                  id,
                  speakingId
                }
              }
            }
          }
        }
      }
    }
  }`;

  return makeGQLRequest( requestString )
    .then( body => {

      let json = JSON.parse(body) ;

      if ( json.errors ) {
        reject( json.errors ) ;
      }

      return json.data.viewer.realmContent.listSpeaking.members.edges ;
    })

}


let makeGQLRequest = ( requestString ) => {

    const options = {
      url: THENIB_GRAPHQL_URL,
      method: 'POST',
      headers: {
        'content-type': 'application/graphql'
      },
      body: requestString
    };

    return request( options ) ;
}

