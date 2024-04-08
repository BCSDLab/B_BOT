function findMentionMessage(track: string, member_type: string)  {
  if(track === 'all') {
    if (member_type === 'all') return `모든 동아리원`
    else if (member_type === 'beginner') return '모든 비기너'
    else if (member_type === 'regular')  return '모든 레귤러'
    else return '모든 멘토'
  }
  else if (track === 'frontend') {
    if (member_type === 'all') return `모든 프론트엔드 트랙`
    else if (member_type === 'beginner') return '모든 프론트엔드 비기너'
    else if (member_type === 'regular')  return '모든 프론트엔드 레귤러'
    else return '모든 프론트엔드 멘토'
  }
  else if (track === 'backend'){
    if (member_type === 'all') return `모든 벡엔드 트랙`
    else if (member_type === 'beginner') return '모든 벡엔드 비기너'
    else if (member_type === 'regular')  return '모든 벡엔드 레귤러'
    else return '모든 벡엔드 멘토'
  }
  else if (track === 'uiux') {
    if (member_type === 'all') return `모든 UI/UX 트랙`
    else if (member_type === 'beginner') return '모든 UI/UX 비기너'
    else if (member_type === 'regular')  return '모든 UI/UX 레귤러'
    else return '모든 UI/UX 멘토'
  }
  else if (track === 'android') {
    if (member_type === 'all') return `모든 안드로이드 트랙`
    else if (member_type === 'beginner') return '모든 안드로이드 비기너'
    else if (member_type === 'regular')  return '모든 안드로이드 레귤러'
    else return '모든 안드로이드 멘토'
  }
  else if (track === 'ios') {
    if (member_type === 'all') return `모든 IOS 트랙`
    else if (member_type === 'beginner') return '모든 IOS 비기너'
    else if (member_type === 'regular')  return '모든 IOS 레귤러'
    else return '모든 IOS 멘토'
  }
  else if (track === 'pm') {
    if (member_type === 'all') return `모든 PM 트랙`
    else if (member_type === 'beginner') return '모든 PM 비기너'
    else if (member_type === 'regular')  return '모든 PM 레귤러'
    else return '모든 PM 멘토'
  }
  else if (track === 'da') {
    if (member_type === 'all') return `모든 DA 트랙`
    else if (member_type === 'beginner') return '모든 DA 비기너'
    else if (member_type === 'regular')  return '모든 DA 레귤러'
    else return '모든 DA 멘토'
  }
  else if (track === 'game') {
    if (member_type === 'all') return `모든 게임 트랙`
    else if (member_type === 'beginner') return '모든 게임 비기너'
    else if (member_type === 'regular')  return '모든 게임 레귤러'
    else return '모든 게임 멘토'
  }
};

export default findMentionMessage;