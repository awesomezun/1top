import React from 'react';
import {StyleSheet,Text as NativeText,type TextProps} from 'react-native';

export const fonts={regular:'IBMPlexSansKR-Regular',medium:'IBMPlexSansKR-Medium',semibold:'IBMPlexSansKR-SemiBold',bold:'IBMPlexSansKR-Bold'};

// Embedded static faces have the same PostScript names on iOS and Android.
// Select the face explicitly so Android does not synthesize a different bold.
export function Text({style,...props}:TextProps){
  const flat=StyleSheet.flatten(style)||{};
  const weight=flat.fontWeight==='bold'?700:Number(flat.fontWeight)||400;
  const family=weight>=700?fonts.bold:weight>=600?fonts.semibold:weight>=500?fonts.medium:fonts.regular;
  // IBM Plex Sans KR carries tall ascent and descent, so Android's default line box is far taller than the
  // iPhone's system font: lines without their own height get the iPhone's (about 1.25 of the size), and
  // Android's extra font padding is off, so rows, legends and tiles take the same space on both phones.
  const size=typeof flat.fontSize==='number'?flat.fontSize:14,line=flat.lineHeight??Math.round(size*1.25);
  return <NativeText {...props} style={[style,{fontFamily:family,fontWeight:'normal',lineHeight:line,includeFontPadding:false}]}/>;
}
